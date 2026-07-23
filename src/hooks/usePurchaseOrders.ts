import { useState, useEffect, useCallback } from 'react';
import type { PurchaseOrder, PurchaseOrderItem } from '@/types';
import {
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  generatePurchaseOrderFolio,
} from '@/db/database';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import {
  applyPurchaseOrderReceiveStock,
  cancelPurchaseOrderPendingLine,
  derivePurchaseOrderEstado,
  planPurchaseOrderReceive,
  type PurchaseOrderReceiveLineInput,
} from '@/lib/purchaseOrderLogic';
import {
  createPurchaseOrderFirestore,
  deletePurchaseOrderFirestore,
  getPurchaseOrderFirestore,
  subscribePurchaseOrdersCatalog,
  updatePurchaseOrderFirestore,
} from '@/lib/firestore/purchaseOrdersFirestore';
import { useProducts } from '@/hooks/useProducts';

async function persistWithRetry(fn: () => Promise<void>, attempts = 3): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      last = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last ?? 'error desconocido'));
}

export function usePurchaseOrders() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { products, adjustStock, editProduct } = useProducts();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getPurchaseOrders(effectiveSucursalId);
      setOrders(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar pedidos de proveedor');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      setLoading(true);
      const unsub = subscribePurchaseOrdersCatalog(effectiveSucursalId, (rows) => {
        setOrders(rows);
        setError(null);
        setLoading(false);
      });
      return unsub;
    }
    void loadLocal();
  }, [effectiveSucursalId, loadLocal]);

  const registerOrder = async (
    order: Omit<PurchaseOrder, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'estado'>
  ): Promise<PurchaseOrder | undefined> => {
    const productos = order.productos.map((it) => ({
      ...it,
      cantidadRecibida: 0,
    }));
    const payload = {
      ...order,
      productos,
      estado: 'esperando_mercancia' as const,
      sucursalId: effectiveSucursalId,
    };
    try {
      if (effectiveSucursalId) {
        return await createPurchaseOrderFirestore(effectiveSucursalId, payload);
      }
      const folio = await generatePurchaseOrderFolio();
      const id = await createPurchaseOrder({ ...payload, folio });
      await loadLocal();
      return (await getPurchaseOrders(effectiveSucursalId)).find((o) => o.id === id);
    } catch (err) {
      throw err;
    }
  };

  const resolveFreshOrder = async (orderId: string): Promise<PurchaseOrder> => {
    if (effectiveSucursalId) {
      const fresh = await getPurchaseOrderFirestore(effectiveSucursalId, orderId);
      if (!fresh) throw new Error('Pedido no encontrado. Actualice la lista e intente de nuevo.');
      return fresh;
    }
    const list = await getPurchaseOrders(effectiveSucursalId);
    const fresh = list.find((o) => o.id === orderId);
    if (!fresh) throw new Error('Pedido no encontrado. Actualice la lista e intente de nuevo.');
    return fresh;
  };

  const receiveOrderLines = async (
    order: PurchaseOrder,
    lines: PurchaseOrderReceiveLineInput[]
  ): Promise<void> => {
    const hasQty = lines.some((l) => (Number(l.cantidadRecibir) || 0) > 0);
    if (!hasQty) throw new Error('Indique al menos una cantidad a recibir.');

    // Siempre contra el pedido en BD (no el snapshot del diálogo), para bloquear reintentos.
    const fresh = await resolveFreshOrder(order.id);
    if (fresh.estado === 'cancelada') {
      throw new Error('Este pedido está cancelado; no se puede recibir mercancía.');
    }

    const { nextProductos, stockOps } = planPurchaseOrderReceive(fresh, lines);
    if (stockOps.length === 0) {
      throw new Error('Indique al menos una cantidad a recibir.');
    }

    const estado = derivePurchaseOrderEstado(nextProductos);
    const updates: Partial<PurchaseOrder> = { productos: nextProductos, estado };

    const persistOrder = async () => {
      if (effectiveSucursalId) {
        await updatePurchaseOrderFirestore(effectiveSucursalId, fresh.id, updates);
      } else {
        await updatePurchaseOrder(fresh.id, updates);
        await loadLocal();
      }
    };

    // 1) Guardar cantidades recibidas PRIMERO → un reintento ya no tiene pendiente.
    await persistWithRetry(persistOrder, 3);

    // 2) Inventario después. Si falla, el pedido ya no invita a recibir de nuevo.
    try {
      await applyPurchaseOrderReceiveStock(fresh, stockOps, {
        adjustStock,
        editProduct,
        getProduct: (id) => products.find((p) => p.id === id),
      });
    } catch (stockErr) {
      const detail = stockErr instanceof Error ? stockErr.message : 'error desconocido';
      throw new Error(
        `El pedido ya quedó marcado como recibido, pero falló al actualizar el inventario (${detail}). No vuelva a confirmar esta recepción: revise el historial de abasto y ajuste existencias si hace falta.`
      );
    }
  };

  const cancelPendingLine = async (order: PurchaseOrder, lineId: string): Promise<PurchaseOrder> => {
    const { productos, estado } = cancelPurchaseOrderPendingLine(order, lineId);
    const updates: Partial<PurchaseOrder> = { productos, estado };
    try {
      if (effectiveSucursalId) {
        await updatePurchaseOrderFirestore(effectiveSucursalId, order.id, updates);
      } else {
        await updatePurchaseOrder(order.id, updates);
        await loadLocal();
      }
      return { ...order, ...updates, updatedAt: new Date() };
    } catch (err) {
      throw err;
    }
  };

  const cancelOrder = async (orderId: string): Promise<void> => {
    try {
      if (effectiveSucursalId) {
        await updatePurchaseOrderFirestore(effectiveSucursalId, orderId, { estado: 'cancelada' });
      } else {
        await updatePurchaseOrder(orderId, { estado: 'cancelada' });
        await loadLocal();
      }
    } catch (err) {
      throw err;
    }
  };

  const removeOrder = async (orderId: string): Promise<void> => {
    try {
      if (effectiveSucursalId) {
        await deletePurchaseOrderFirestore(effectiveSucursalId, orderId);
      } else {
        await deletePurchaseOrder(orderId);
        await loadLocal();
      }
    } catch (err) {
      throw err;
    }
  };

  return {
    orders,
    loading,
    error,
    registerOrder,
    receiveOrderLines,
    cancelPendingLine,
    cancelOrder,
    removeOrder,
    products,
    editProduct,
  };
}

export type { PurchaseOrderItem };
