import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Sale } from '@/types';
import {
  getSales,
  getSaleById,
  getSalesByDateRange,
  createSale,
  cancelSale,
  completePendingSale as completePendingSaleDb,
} from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { subscribeSalesCatalog, subscribeSaleDocument } from '@/lib/firestore/salesFirestore';
import { reportHookFailure } from '@/lib/appEventLog';

// ============================================
// HOOK DE VENTAS
// ============================================

export function useSales(limit: number = 100) {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSalesLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSales(limit);
      setSales(data);
      setError(null);
    } catch (err) {
      reportHookFailure('hook:useSales', 'Cargar ventas (local)', err);
      setError('Error al cargar ventas');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (sucursalId) {
      setLoading(true);
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
          reportHookFailure('hook:useSales', 'Cargar ventas', err);
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
      reportHookFailure('hook:useSales', 'Crear venta', err);
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
      reportHookFailure('hook:useSales', 'Cancelar venta', err);
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
      reportHookFailure('hook:useSales', 'Completar venta pendiente', err);
      setError('Error al completar venta');
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
  };
}

export function useSalesByDateRange(inicio: Date, fin: Date) {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ total: 0, count: 0 });

  const applyFilter = useCallback(
    (all: Sale[]) => {
      const normalized = all.map((s) => ({
        ...s,
        productos: Array.isArray(s.productos) ? s.productos : [],
      }));
      const filtered = normalized.filter((s) => s.createdAt >= inicio && s.createdAt < fin);
      const total = filtered.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
      setSales(filtered);
      setTotals({ total, count: filtered.length });
    },
    [inicio, fin]
  );

  const loadSalesLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSalesByDateRange(inicio, fin);
      const normalized = data.map((s) => ({
        ...s,
        productos: Array.isArray(s.productos) ? s.productos : [],
      }));
      setSales(normalized);
      const total = normalized.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
      setTotals({ total, count: normalized.length });
    } catch (err) {
      reportHookFailure('hook:useSalesByDateRange', 'Cargar ventas por rango', err);
      console.error('Error al cargar ventas:', err);
    } finally {
      setLoading(false);
    }
  }, [inicio, fin]);

  useEffect(() => {
    if (sucursalId) {
      setLoading(true);
      const unsub = subscribeSalesCatalog(sucursalId, (all) => {
        applyFilter(all);
        setLoading(false);
      });
      return unsub;
    }

    loadSalesLocal();
  }, [sucursalId, loadSalesLocal, applyFilter]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      return;
    }
    await loadSalesLocal();
  }, [sucursalId, loadSalesLocal]);

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
        reportHookFailure('hook:useSaleDetails', 'Cargar venta (local)', err);
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
