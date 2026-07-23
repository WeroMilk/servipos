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
  applyPurchaseOrderReceive,
  cancelPurchaseOrderPendingLine,
  derivePurchaseOrderEstado,
  purchaseOrderPendienteLinea,
  type PurchaseOrderReceiveLineInput,
} from '@/lib/purchaseOrderLogic';
import {
  createPurchaseOrderFirestore,
  deletePurchaseOrderFirestore,
  subscribePurchaseOrdersCatalog,
  updatePurchaseOrderFirestore,
} from '@/lib/firestore/purchaseOrdersFirestore';
import { useProducts } from '@/hooks/useProducts';

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

  const receiveOrderLines = async (
    order: PurchaseOrder,
    lines: PurchaseOrderReceiveLineInput[]
  ): Promise<void> => {
    const hasQty = lines.some((l) => (Number(l.cantidadRecibir) || 0) > 0);
    if (!hasQty) throw new Error('Indique al menos una cantidad a recibir.');

    // Revalidar pendientes con el pedido más reciente en memoria (evita reintentos ciegos).
    for (const line of lines) {
      const qtyIn = Math.max(0, Math.floor(Number(line.cantidadRecibir) || 0));
      if (qtyIn <= 0) continue;
      const item = order.productos.find((p) => p.lineId === line.lineId);
      if (!item) throw new Error('Línea de pedido no encontrada.');
      const pendiente = purchaseOrderPendienteLinea(item);
      if (qtyIn > pendiente) {
        throw new Error(
          `La cantidad a recibir de «${item.nombre ?? item.productId}» (${qtyIn}) supera lo pendiente (${pendiente}). Si ya confirmó antes y vio error, revise el historial de abasto antes de reintentar.`
        );
      }
    }

    const nextProductos = await applyPurchaseOrderReceive(order, lines, {
      adjustStock,
      editProduct,
      getProduct: (id) => products.find((p) => p.id === id),
    });
    const estado = derivePurchaseOrderEstado(nextProductos);
    const updates: Partial<PurchaseOrder> = { productos: nextProductos, estado };

    const persistOrder = async () => {
      if (effectiveSucursalId) {
        await updatePurchaseOrderFirestore(effectiveSucursalId, order.id, updates);
      } else {
        await updatePurchaseOrder(order.id, updates);
        await loadLocal();
      }
    };

    try {
      await persistOrder();
    } catch (firstErr) {
      try {
        await persistOrder();
      } catch (secondErr) {
        const detail =
          secondErr instanceof Error
            ? secondErr.message
            : firstErr instanceof Error
              ? firstErr.message
              : 'error desconocido';
        throw new Error(
          `El inventario ya se actualizó, pero no se pudo guardar el pedido (${detail}). No vuelva a confirmar: revise el pedido y el historial de abasto.`
        );
      }
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
