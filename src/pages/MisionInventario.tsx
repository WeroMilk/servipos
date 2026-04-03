import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell } from '@/components/ui-custom/PageShell';
import { useProducts } from '@/hooks/useProducts';
import { useAuthStore, useAppStore } from '@/stores';
import {
  MISION_INVENTARIO_DIARIO,
  loadMissionDoneIds,
  pickDailyMissionProducts,
  saveMissionDoneIds,
} from '@/lib/dailyInventoryMission';
import { formatDateKeyMx, getMexicoDateKey } from '@/lib/quincenaMx';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

export function MisionInventario() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { products, loading } = useProducts();

  const [dateKey, setDateKey] = useState(() => getMexicoDateKey());
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<Set<string>>(() => new Set());

  const allowed = hasPermission('inventario:mision_diaria');

  useEffect(() => {
    const id = setInterval(() => {
      setDateKey((prev) => {
        const next = getMexicoDateKey();
        return next !== prev ? next : prev;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setDone(loadMissionDoneIds(user.id, dateKey));
  }, [user?.id, dateKey]);

  const misionList = useMemo(() => {
    if (!user?.id) return [];
    return pickDailyMissionProducts(products, user.id, dateKey, MISION_INVENTARIO_DIARIO);
  }, [products, user?.id, dateKey]);

  const total = misionList.length;
  const hechos = useMemo(() => misionList.filter((p) => done.has(p.id)).length, [misionList, done]);
  const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return misionList;
    return misionList.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.codigoBarras && String(p.codigoBarras).toLowerCase().includes(q))
    );
  }, [misionList, query]);

  const toggle = useCallback(
    (p: Product) => {
      if (!user?.id) return;
      setDone((prev) => {
        const next = new Set(prev);
        const wasAllDone = misionList.length > 0 && misionList.every((x) => prev.has(x.id));
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        saveMissionDoneIds(user.id, dateKey, next);
        const nowAllDone = misionList.length > 0 && misionList.every((x) => next.has(x.id));
        if (nowAllDone && !wasAllDone) {
          queueMicrotask(() =>
            addToast({
              type: 'success',
              message: `¡Listo! Completaste las ${misionList.length} revisiones de hoy.`,
              logToAppEvents: true,
            })
          );
        }
        return next;
      });
    },
    [user?.id, dateKey, misionList, addToast]
  );

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageShell
      title="Misiones de inventario"
      subtitle={`${formatDateKeyMx(dateKey)} · ${MISION_INVENTARIO_DIARIO} artículos asignados para revisar físicamente (existencia en anaquel vs sistema).`}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-6 [-webkit-overflow-scrolling:touch]">
        <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 dark:from-cyan-500/10 dark:to-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-slate-900 dark:text-slate-100">Progreso del día</CardTitle>
            <CardDescription>
              Marque cada artículo cuando lo haya contado o verificado. La lista cambia cada día; es solo suya con su
              usuario.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <p className="text-3xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">
                {hechos}
                <span className="text-lg font-semibold text-slate-500 dark:text-slate-500">/{total}</span>
              </p>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Label htmlFor="mision-buscar" className="text-slate-600 dark:text-slate-400">
            Buscar en la lista de hoy
          </Label>
          <Input
            id="mision-buscar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, SKU o código de barras…"
            className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/80"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-600 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando artículos…
          </div>
        ) : total === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            No hay productos activos en catálogo para armar la misión. Cuando haya existencias en inventario, aquí
            aparecerán hasta {MISION_INVENTARIO_DIARIO} artículos por día.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const isDone = done.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors sm:items-center sm:px-4',
                      isDone
                        ? 'border-emerald-500/35 bg-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800/80'
                    )}
                  >
                    <span className="shrink-0 pt-0.5 sm:pt-0" aria-hidden>
                      {isDone ? (
                        <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Circle className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug text-slate-900 dark:text-slate-100">{p.nombre}</span>
                      <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                        SKU {p.sku}
                        {p.codigoBarras?.trim() ? ` · ${String(p.codigoBarras).trim()}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs uppercase tracking-wide text-slate-500 dark:text-slate-500">
                        En sistema
                      </span>
                      <span className="text-lg font-semibold tabular-nums text-cyan-700 dark:text-cyan-300">
                        {p.existencia}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length === 0 && total > 0 && query.trim() ? (
          <p className="text-center text-sm text-slate-500 dark:text-slate-500">Ningún artículo coincide con la búsqueda.</p>
        ) : null}

        {total > 0 ? (
          <p className="text-center text-xs leading-relaxed text-slate-500 dark:text-slate-500">
            Si encuentra diferencias de stock, avise a un encargado o use Inventario (si tiene permiso) para ajustar.
            Esta pantalla no modifica existencias.
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
