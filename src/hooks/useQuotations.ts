import { useState, useEffect, useCallback } from 'react';
import type { Quotation } from '@/types';
import {
  getQuotations,
  getQuotationById,
  createQuotation,
  updateQuotation,
  createSale,
  convertQuotationToSale,
  generateQuotationFolio,
  deleteQuotation,
  revertQuotationToPending,
} from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { reportHookFailure } from '@/lib/appEventLog';
import {
  createQuotationFirestore,
  deleteQuotationFirestore,
  subscribeQuotationsCatalog,
  updateQuotationFirestore,
} from '@/lib/firestore/quotationsFirestore';

// ============================================
// HOOK DE COTIZACIONES
// ============================================

export function useQuotations() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getQuotations(effectiveSucursalId);
      setQuotations(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar cotizaciones');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      setLoading(true);
      const unsub = subscribeQuotationsCatalog(effectiveSucursalId, (rows) => {
        setQuotations(rows);
        setError(null);
        setLoading(false);
      });
      return unsub;
    }
    void loadQuotations();
  }, [loadQuotations]);

  const addQuotation = async (
    quotation: Omit<Quotation, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>
  ): Promise<Quotation | undefined> => {
    try {
      const sid = getEffectiveSucursalId();
      if (sid) {
        return await createQuotationFirestore(sid, {
          ...quotation,
          sucursalId: sid,
        });
      }
      const folio = await generateQuotationFolio(sid);
      const id = await createQuotation({ ...quotation, folio, sucursalId: sid });
      await loadQuotations();
      return (await getQuotationById(id)) ?? undefined;
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Crear cotización', err);
      setError('Error al crear cotización');
      throw err;
    }
  };

  const editQuotation = async (id: string, updates: Partial<Quotation>) => {
    try {
      if (effectiveSucursalId) {
        await updateQuotationFirestore(effectiveSucursalId, id, updates);
        return;
      }
      await updateQuotation(id, updates);
      await loadQuotations();
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Actualizar cotización', err);
      setError('Error al actualizar cotización');
      throw err;
    }
  };

  const convertToSale = async (
    quotationId: string,
    usuarioId: string,
    usuarioNombre?: string
  ) => {
    try {
      const sucursalId = getEffectiveSucursalId();
      if (sucursalId) {
        const q = quotations.find((x) => x.id === quotationId);
        if (!q) throw new Error('Cotización no encontrada');
        const { id: saleId } = await createSale(
          {
            folio: '',
            clienteId: q.clienteId,
            cliente: q.cliente,
            productos: q.productos.map((it) => ({
              id: crypto.randomUUID(),
              productId: it.productId,
              productoNombre: it.producto?.nombre?.trim() || undefined,
              cantidad: it.cantidad,
              precioUnitario: it.precioUnitario,
              descuento: it.descuento,
              impuesto: it.impuesto,
              subtotal: it.subtotal,
              total: it.total,
            })),
            subtotal: q.subtotal,
            descuento: q.descuento,
            impuestos: q.impuestos,
            total: q.total,
            formaPago: '01',
            metodoPago: 'PUE',
            pagos: [],
            estado: 'pendiente',
            notas: `Convertido de cotización ${q.folio}`,
            usuarioId,
            usuarioNombre,
          },
          { sucursalId }
        );
        await updateQuotationFirestore(sucursalId, quotationId, {
          estado: 'convertida',
          ventaId: saleId,
        });
        return saleId;
      }
      const saleId = await convertQuotationToSale(quotationId, usuarioId, sucursalId, usuarioNombre);
      await loadQuotations();
      return saleId;
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Convertir cotización a venta', err);
      setError('Error al convertir cotización');
      throw err;
    }
  };

  const removeQuotation = async (id: string) => {
    try {
      if (effectiveSucursalId) {
        await deleteQuotationFirestore(effectiveSucursalId, id);
        return;
      }
      await deleteQuotation(id);
      await loadQuotations();
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Eliminar cotización', err);
      setError('Error al eliminar cotización');
      throw err;
    }
  };

  const revertToPending = async (quotationId: string) => {
    try {
      if (effectiveSucursalId) {
        await updateQuotationFirestore(effectiveSucursalId, quotationId, {
          estado: 'pendiente',
          ventaId: undefined,
        });
        return;
      }
      await revertQuotationToPending(quotationId);
      await loadQuotations();
    } catch (err) {
      reportHookFailure('hook:useQuotations', 'Revertir cotización a pendiente', err);
      setError('Error al actualizar cotización');
      throw err;
    }
  };

  return {
    quotations,
    loading,
    error,
    refresh: loadQuotations,
    addQuotation,
    editQuotation,
    convertToSale,
    revertToPending,
    removeQuotation,
  };
}

export function useQuotationDetails(quotationId: string | null) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!quotationId) {
      setQuotation(null);
      return;
    }

    const loadQuotation = async () => {
      try {
        setLoading(true);
        const data = await getQuotationById(quotationId);
        setQuotation(data || null);
      } catch (err) {
        reportHookFailure('hook:useQuotationDetails', 'Cargar cotización', err);
        console.error('Error al cargar cotización:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQuotation();
  }, [quotationId]);

  return { quotation, loading };
}
