import { useState, useEffect, useCallback, useRef } from 'react';
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
  getQuotationsCatalogSnapshot,
} from '@/lib/firestore/quotationsFirestore';
import { cotizacionDebeEliminarsePorCaducidad } from '@/lib/quotationCaducidad';

// ============================================
// HOOK DE COTIZACIONES
// ============================================

export function useQuotations() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [quotations, setQuotations] = useState<Quotation[]>(() => {
    if (!effectiveSucursalId) return [];
    return getQuotationsCatalogSnapshot().filter((q) => !cotizacionDebeEliminarsePorCaducidad(q));
  });
  const [loading, setLoading] = useState(() => {
    if (!effectiveSucursalId) return true;
    return getQuotationsCatalogSnapshot().length === 0;
  });
  const [error, setError] = useState<string | null>(null);
  const purgingIdsRef = useRef(new Set<string>());

  const purgeCaducadas = useCallback(
    async (rows: Quotation[]) => {
      const toDelete = rows.filter(cotizacionDebeEliminarsePorCaducidad);
      if (toDelete.length === 0) return;
      const sid = effectiveSucursalId;
      let deletedLocal = false;
      for (const q of toDelete) {
        if (purgingIdsRef.current.has(q.id)) continue;
        purgingIdsRef.current.add(q.id);
        try {
          if (sid) {
            await deleteQuotationFirestore(sid, q.id);
          } else {
            await deleteQuotation(q.id);
            deletedLocal = true;
          }
        } catch (err) {
          console.error('Eliminar cotización caducada:', q.id, err);
        } finally {
          purgingIdsRef.current.delete(q.id);
        }
      }
      if (!sid && deletedLocal) {
        const deletedIds = new Set(toDelete.map((q) => q.id));
        setQuotations((prev) => prev.filter((q) => !deletedIds.has(q.id)));
      }
    },
    [effectiveSucursalId]
  );

  const ingestQuotations = useCallback(
    (rows: Quotation[]) => {
      const visible = rows.filter((q) => !cotizacionDebeEliminarsePorCaducidad(q));
      const expired = rows.filter(cotizacionDebeEliminarsePorCaducidad);
      setQuotations(visible);
      setError(null);
      setLoading(false);
      if (expired.length > 0) void purgeCaducadas(expired);
    },
    [purgeCaducadas]
  );

  const loadQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getQuotations(effectiveSucursalId);
      ingestQuotations(data);
    } catch (err) {
      setError('Error al cargar cotizaciones');
      console.error(err);
      setLoading(false);
    }
  }, [effectiveSucursalId, ingestQuotations]);

  useEffect(() => {
    if (effectiveSucursalId) {
      const snap = getQuotationsCatalogSnapshot();
      if (snap.length === 0) {
        setLoading(true);
      } else {
        ingestQuotations(snap);
      }
      const unsub = subscribeQuotationsCatalog(effectiveSucursalId, ingestQuotations);
      return unsub;
    }
    void loadQuotations();
  }, [effectiveSucursalId, loadQuotations, ingestQuotations]);

  useEffect(() => {
    const tick = () => {
      setQuotations((prev) => {
        const expired = prev.filter(cotizacionDebeEliminarsePorCaducidad);
        if (expired.length === 0) return prev;
        void purgeCaducadas(expired);
        return prev.filter((q) => !cotizacionDebeEliminarsePorCaducidad(q));
      });
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [purgeCaducadas]);

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
        if (q.estado === 'convertida') throw new Error('La cotización ya fue cobrada');
        if (q.ventaId && q.estado === 'pendiente') {
          return q.ventaId;
        }
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
        /** Pendiente hasta cobrar; `ventaId` apunta a la venta abierta en POS. */
        await updateQuotationFirestore(sucursalId, quotationId, {
          estado: 'pendiente',
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
