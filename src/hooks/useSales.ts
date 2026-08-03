import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Sale } from '@/types';
import {
  getSales,
  getSaleById,
  getSalesByDateRange,
  createSale,
  cancelSale,
  completePendingSale as completePendingSaleDb,
  appendPagosToCompletedSale as appendPagosToCompletedSaleDb,
  partialReturnSale as partialReturnSaleDb,
} from '@/db/database';
import type { DevolucionLineInput } from '@/lib/salePartialReturnCompute';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { subscribeSalesCatalog, subscribeSaleDocument, getSalesCatalogSnapshot, fetchSalesInDateRangeFirestore } from '@/lib/firestore/salesFirestore';
import { saleEnRangoHistorial } from '@/lib/saleHistorialFecha';

// ============================================
// HOOK DE VENTAS
// ============================================

export function useSales(limit: number = 5000) {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [sales, setSales] = useState<Sale[]>(() => {
    if (!sucursalId) return [];
    return getSalesCatalogSnapshot().slice(0, limit);
  });
  const [loading, setLoading] = useState(() => {
    if (!sucursalId) return true;
    return getSalesCatalogSnapshot().length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  const loadSalesLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSales(limit);
      setSales(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar ventas');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (sucursalId) {
      const snap = getSalesCatalogSnapshot();
      if (snap.length === 0) {
        setLoading(true);
      } else {
        setSales(snap.slice(0, limit));
      }
      const unsub = subscribeSalesCatalog(sucursalId, (all) => {
        setSales(all.slice(0, limit));
        setError(null);
        setLoading(false);
      });
      return unsub;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getSales(limit);
        if (!cancelled) {
          setSales(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Error al cargar ventas');
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sucursalId, limit]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      return;
    }
    await loadSalesLocal();
  }, [sucursalId, loadSalesLocal]);

  const addSale = async (sale: Omit<Sale, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
    try {
      const sid = getEffectiveSucursalId();
      const { id, folio } = await createSale(
        { ...sale, folio: '' } as Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
        { sucursalId: sid }
      );
      if (!sid) {
        await loadSalesLocal();
      }
      return { id, folio };
    } catch (err) {
      setError('Error al crear venta');
      throw err;
    }
  };

  const cancel = async (
    id: string,
    opts?: { motivo?: string; cancelacionMotivo?: 'devolucion' | 'panel' }
  ) => {
    try {
      const sid = getEffectiveSucursalId();
      await cancelSale(id, { ...opts, sucursalId: sid });
      if (!sid) {
        await loadSalesLocal();
      }
    } catch (err) {
      setError('Error al cancelar venta');
      throw err;
    }
  };

  const completePendingSale = async (
    id: string,
    patch: Parameters<typeof completePendingSaleDb>[1]
  ) => {
    try {
      const sid = getEffectiveSucursalId();
      await completePendingSaleDb(id, patch, { sucursalId: sid });
      if (!sid) {
        await loadSalesLocal();
      }
    } catch (err) {
      setError('Error al completar venta');
      throw err;
    }
  };

  const appendPagosToCompletedSale = async (
    id: string,
    patch: Parameters<typeof appendPagosToCompletedSaleDb>[1]
  ) => {
    try {
      const sid = getEffectiveSucursalId();
      await appendPagosToCompletedSaleDb(id, patch, { sucursalId: sid });
      if (!sid) {
        await loadSalesLocal();
      }
    } catch (err) {
      setError('Error al registrar cobro');
      throw err;
    }
  };

  const partialReturnSale = async (
    id: string,
    opts: { returns: DevolucionLineInput[]; motivo?: string }
  ) => {
    try {
      const sid = getEffectiveSucursalId();
      const out = await partialReturnSaleDb(id, { ...opts, sucursalId: sid });
      if (!sid) {
        await loadSalesLocal();
      }
      return out;
    } catch (err) {
      setError('Error al registrar devolución');
      throw err;
    }
  };

  return {
    sales,
    loading,
    error,
    refresh,
    addSale,
    cancelSale: cancel,
    completePendingSale,
    appendPagosToCompletedSale,
    partialReturnSale,
  };
}

export function useSalesByDateRange(inicio: Date, fin: Date) {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ total: 0, count: 0 });

  const applyList = useCallback((list: Sale[]) => {
    const normalized = list.map((s) => ({
      ...s,
      productos: Array.isArray(s.productos) ? s.productos : [],
    }));
    const total = normalized.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    setSales(normalized);
    setTotals({ total, count: normalized.length });
  }, []);

  const loadSalesLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSalesByDateRange(inicio, fin);
      applyList(data);
    } catch (err) {
      console.error('Error al cargar ventas:', err);
    } finally {
      setLoading(false);
    }
  }, [inicio, fin, applyList]);

  useEffect(() => {
    if (sucursalId) {
      let cancelled = false;
      setLoading(true);
      void (async () => {
        try {
          const data = await fetchSalesInDateRangeFirestore(sucursalId, inicio, fin);
          if (!cancelled) applyList(data);
        } catch (err) {
          console.error('Error al cargar ventas por rango:', err);
          if (!cancelled) {
            // Fallback: catálogo reciente filtrado (puede estar incompleto).
            const snap = getSalesCatalogSnapshot().filter((s) =>
              saleEnRangoHistorial(s, inicio, fin)
            );
            applyList(snap);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    loadSalesLocal();
  }, [sucursalId, inicio, fin, applyList, loadSalesLocal]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      setLoading(true);
      try {
        const data = await fetchSalesInDateRangeFirestore(sucursalId, inicio, fin);
        applyList(data);
      } catch (err) {
        console.error('Error al refrescar ventas por rango:', err);
      } finally {
        setLoading(false);
      }
      return;
    }
    await loadSalesLocal();
  }, [sucursalId, inicio, fin, applyList, loadSalesLocal]);

  return { sales, loading, totals, refresh };
}

export function useTodaySales() {
  /** Fechas estables por montaje: evita re-fetch en bucle (parpadeo en Panel). */
  const { inicio, fin } = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { inicio: start, fin: end };
  }, []);

  return useSalesByDateRange(inicio, fin);
}

export function useSaleDetails(saleId: string | null) {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [sale, setSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saleId) {
      setSale(null);
      return;
    }

    if (sucursalId) {
      setLoading(true);
      const unsub = subscribeSaleDocument(sucursalId, saleId, (row) => {
        setSale(row);
        setLoading(false);
      });
      return unsub;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getSaleById(saleId);
        if (!cancelled) setSale(data || null);
      } catch (err) {
        console.error('Error al cargar venta:', err);
        if (!cancelled) setSale(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId, sucursalId]);

  return { sale, loading };
}
