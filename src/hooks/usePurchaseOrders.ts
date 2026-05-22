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
import { reportHookFailure } from '@/lib/appEventLog';
import {
  applyPurchaseOrderReceive,
  derivePurchaseOrderEstado,
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
      reportHookFailure('hook:usePurchaseOrders', 'Registrar pedido', err);
      throw err;
    }
  };

  const receiveOrderLines = async (
    order: PurchaseOrder,
    lines: PurchaseOrderReceiveLineInput[]
  ): Promise<void> => {
    const hasQty = lines.some((l) => (Number(l.cantidadRecibir) || 0) > 0);
    if (!hasQty) throw new Error('Indique al menos una cantidad a recibir.');

    const nextProductos = await applyPurchaseOrderReceive(order, lines, {
      adjustStock,
      editProduct,
      getProduct: (id) => products.find((p) => p.id === id),
    });
    const estado = derivePurchaseOrderEstado(nextProductos);
    const updates: Partial<PurchaseOrder> = { productos: nextProductos, estado };
    try {
      if (effectiveSucursalId) {
        await updatePurchaseOrderFirestore(effectiveSucursalId, order.id, updates);
      } else {
        await updatePurchaseOrder(order.id, updates);
        await loadLocal();
      }
    } catch (err) {
      reportHookFailure('hook:usePurchaseOrders', 'Actualizar pedido tras recepción', err);
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
      reportHookFailure('hook:usePurchaseOrders', 'Cancelar pedido', err);
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
      reportHookFailure('hook:usePurchaseOrders', 'Eliminar pedido', err);
      throw err;
    }
  };

  return {
    orders,
    loading,
    error,
    registerOrder,
    receiveOrderLines,
    cancelOrder,
    removeOrder,
    products,
  };
}

export type { PurchaseOrderItem };
