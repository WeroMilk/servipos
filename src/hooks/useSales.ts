import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Sale } from '@/types';
import {
  getSales,
  getSaleById,
  getSalesByDateRange,
  createSale,
  cancelSale,
} from '@/db/database';
import { useAuthStore } from '@/stores';
import { subscribeSalesCatalog, saleDocToSale } from '@/lib/firestore/salesFirestore';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================
// HOOK DE VENTAS
// ============================================

export function useSales(limit: number = 100) {
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
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
      const sid = useAuthStore.getState().user?.sucursalId;
      const id = await createSale(
        { ...sale, folio: '' } as Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>,
        { sucursalId: sid }
      );
      if (!sid) {
        await loadSalesLocal();
      }
      return id;
    } catch (err) {
      setError('Error al crear venta');
      throw err;
    }
  };

  const cancel = async (id: string, motivo?: string) => {
    try {
      const sid = useAuthStore.getState().user?.sucursalId;
      await cancelSale(id, motivo, { sucursalId: sid });
      if (!sid) {
        await loadSalesLocal();
      }
    } catch (err) {
      setError('Error al cancelar venta');
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
  };
}

export function useSalesByDateRange(inicio: Date, fin: Date) {
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ total: 0, count: 0 });

  const applyFilter = useCallback(
    (all: Sale[]) => {
      const filtered = all.filter((s) => s.createdAt >= inicio && s.createdAt < fin);
      const total = filtered.reduce((sum, sale) => sum + sale.total, 0);
      setSales(filtered);
      setTotals({ total, count: filtered.length });
    },
    [inicio, fin]
  );

  const loadSalesLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSalesByDateRange(inicio, fin);
      setSales(data);
      const total = data.reduce((sum, sale) => sum + sale.total, 0);
      setTotals({ total, count: data.length });
    } catch (err) {
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
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
  const [sale, setSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saleId) {
      setSale(null);
      return;
    }

    if (sucursalId) {
      setLoading(true);
      const ref = doc(db, 'sucursales', sucursalId, 'sales', saleId);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          setSale(saleDocToSale(snap));
          setLoading(false);
        },
        (err) => {
          console.error('Error al cargar venta:', err);
          setSale(null);
          setLoading(false);
        }
      );
      return () => unsub();
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
