import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, Pencil, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell } from '@/components/ui-custom/PageShell';
import { useProducts } from '@/hooks/useProducts';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAuthStore, useAppStore } from '@/stores';
import {
  addUsedIdsToDay,
  DEFAULT_MISSION_SIZE,
  loadMissionDoneIds,
  loadMissionProductIds,
  loadUsedIdsInDay,
  MAX_MISSION_SIZE,
  mergeMissionDoneIdsInCycle,
  MIN_MISSION_SIZE,
  pickRandomMissionIdsFromProducts,
  saveMissionDoneIds,
  saveMissionProductIds,
} from '@/lib/dailyInventoryMission';
import {
  effectiveDateKeyForMissionPartition,
  formatDateKeyMx,
  getBimonthCycleInfo,
  getMexicoDateKey,
  isMexicoSunday,
} from '@/lib/quincenaMx';
import { printThermalMissionComplete, printThermalMissionInventoryReport } from '@/lib/printTicket';
import {
  buildMissionDayTicketLines,
  fetchInventoryMovementsForUserMexicoDay,
} from '@/lib/missionDayInventoryMovements';
import { userCanSeeInventoryMissions } from '@/lib/userPermissions';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

export function MisionInventario() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const { addToast } = useAppStore();
  const { products, loading } = useProducts();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [dateKey, setDateKey] = useState(() => getMexicoDateKey());
  const [printingMission, setPrintingMission] = useState(false);
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [missionIds, setMissionIds] = useState<string[]>([]);
  const [missionCompleteDialogOpen, setMissionCompleteDialogOpen] = useState(false);
  const [nextMissionCount, setNextMissionCount] = useState(25);

  const allowed = userCanSeeInventoryMissions(user);
  const canEditProducto = hasPermission('inventario:editar');

  useEffect(() => {
    const id = setInterval(() => {
      setDateKey((prev) => {
        const next = getMexicoDateKey();
        return next !== prev ? next : prev;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const partitionDateKey = useMemo(() => effectiveDateKeyForMissionPartition(dateKey), [dateKey]);

  useEffect(() => {
    if (!user?.id) return;
    setDone(loadMissionDoneIds(user.id, partitionDateKey));
  }, [user?.id, partitionDateKey]);

  useEffect(() => {
    if (!user?.id || products.length === 0) return;
    const activeIds = new Set(products.filter((p) => p.activo !== false).map((p) => p.id));
    if (activeIds.size === 0) {
      setMissionIds([]);
      return;
    }
    const stored = loadMissionProductIds(user.id, partitionDateKey);
    if (stored && stored.length > 0) {
      const valid = stored.filter((id) => activeIds.has(id));
      if (valid.length > 0) {
        setMissionIds(valid);
        return;
      }
    }
    const used = loadUsedIdsInDay(user.id, partitionDateKey);
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID ?
        crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const ids = pickRandomMissionIdsFromProducts(products, DEFAULT_MISSION_SIZE, used, seed);
    saveMissionProductIds(user.id, partitionDateKey, ids);
    setMissionIds(ids);
  }, [user?.id, partitionDateKey, products]);

  const cycleInfo = useMemo(() => getBimonthCycleInfo(dateKey), [dateKey]);

  const misionList = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return missionIds.map((id) => map.get(id)).filter((p): p is Product => p != null);
  }, [missionIds, products]);

  const totalActivos = useMemo(
    () => products.filter((p) => p.activo !== false).length,
    [products]
  );

  const revisadosEnCiclo = useMemo(() => {
    if (!user?.id) return 0;
    const merged = mergeMissionDoneIdsInCycle(user.id, dateKey);
    const activos = new Set(products.filter((p) => p.activo !== false).map((p) => p.id));
    let n = 0;
    merged.forEach((id) => {
      if (activos.has(id)) n++;
    });
    return n;
  }, [user?.id, dateKey, products]);

  const pctGlobal =
    totalActivos > 0 ? Math.round((revisadosEnCiclo / totalActivos) * 100) : 0;

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

  const printMissionDayMovements = useCallback(async () => {
    if (!user?.id) return;
    setPrintingMission(true);
    try {
      const rows = await fetchInventoryMovementsForUserMexicoDay(effectiveSucursalId, user.id, dateKey);
      const productById = new Map(products.map((p) => [p.id, p]));
      const lines = buildMissionDayTicketLines(rows, productById);
      printThermalMissionInventoryReport({
        fechaLabel: formatDateKeyMx(dateKey),
        sucursalId: effectiveSucursalId,
        cajeroNombre: user.name?.trim() || user.email,
        movimientos: lines,
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cargar movimientos para imprimir',
      });
    } finally {
      setPrintingMission(false);
    }
  }, [user?.id, user?.name, user?.email, dateKey, effectiveSucursalId, products, addToast]);

  const startAnotherMission = useCallback(() => {
    if (!user?.id) return;
    const raw = Number(nextMissionCount);
    const n = Math.min(
      MAX_MISSION_SIZE,
      Math.max(MIN_MISSION_SIZE, Number.isFinite(raw) ? Math.round(raw) : 25)
    );
    const used = loadUsedIdsInDay(user.id, partitionDateKey);
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID ?
        crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const ids = pickRandomMissionIdsFromProducts(products, n, used, seed);
    if (ids.length === 0) {
      addToast({ type: 'warning', message: 'No hay artículos activos para armar otra misión.' });
      return;
    }
    if (ids.length < n) {
      addToast({
        type: 'info',
        message: `Solo había ${ids.length} artículo(s) disponibles sin repetir lo ya sorteado hoy; se asignó la lista completa.`,
      });
    }
    saveMissionProductIds(user.id, partitionDateKey, ids);
    setMissionIds(ids);
    setMissionCompleteDialogOpen(false);
  }, [user?.id, partitionDateKey, products, nextMissionCount, addToast]);

  const toggle = useCallback(
    (p: Product) => {
      if (!user?.id) return;
      setDone((prev) => {
        const next = new Set(prev);
        const wasAllDone = misionList.length > 0 && misionList.every((x) => prev.has(x.id));
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        saveMissionDoneIds(user.id, partitionDateKey, next);
        const nowAllDone = misionList.length > 0 && misionList.every((x) => next.has(x.id));
        if (nowAllDone && !wasAllDone) {
          const completedIds = misionList.map((x) => x.id);
          const totalEnMision = misionList.length;
          queueMicrotask(() => {
            printThermalMissionComplete({
              fechaLabel: formatDateKeyMx(dateKey),
              sucursalId: effectiveSucursalId,
              cajeroNombre: user.name?.trim() || user.email,
              articulosRevisados: totalEnMision,
              totalEnMision,
            });
            addUsedIdsToDay(user.id, partitionDateKey, completedIds);
            addToast({
              type: 'success',
              message: `¡Listo! Completaste esta misión (${totalEnMision} artículos).`,
              logToAppEvents: true,
            });
            setTimeout(() => setMissionCompleteDialogOpen(true), 500);
          });
        }
        return next;
      });
    },
    [
      user?.id,
      user?.name,
      user?.email,
      partitionDateKey,
      misionList,
      addToast,
      dateKey,
      effectiveSucursalId,
    ]
  );

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const subParts = [
    formatDateKeyMx(dateKey),
    isMexicoSunday(dateKey) ? 'Domingo: misma partición que el sábado' : null,
    `Ciclo ${cycleInfo.cycleLabelEs}`,
    totalActivos > 0 ? `Catálogo: ${revisadosEnCiclo}/${totalActivos} artículos revisados en el ciclo` : null,
  ].filter(Boolean);

  const missionsReady = missionIds.length > 0 || (!loading && totalActivos === 0);

  return (
    <PageShell
      title="Misiones de inventario"
      subtitle={`${subParts.join(' · ')}. Cada misión muestra artículos al azar; las listas sucesivas del mismo día evitan repetir lo ya sorteado cuando el catálogo lo permite.`}
    >
      <Dialog open={missionCompleteDialogOpen} onOpenChange={setMissionCompleteDialogOpen}>
        <DialogContent className="sm:max-w-md" useDialogDescription>
          <DialogHeader>
            <DialogTitle>¿Quieres otra misión?</DialogTitle>
            <DialogDescription>
              Puedes revisar más artículos hoy. Elige cuántos quieres en la siguiente lista (entre {MIN_MISSION_SIZE} y{' '}
              {MAX_MISSION_SIZE}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="mision-siguiente-cantidad">Artículos en la siguiente misión</Label>
            <Input
              id="mision-siguiente-cantidad"
              type="number"
              inputMode="numeric"
              min={MIN_MISSION_SIZE}
              max={MAX_MISSION_SIZE}
              value={nextMissionCount}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) {
                  setNextMissionCount(MIN_MISSION_SIZE);
                  return;
                }
                setNextMissionCount(Math.min(MAX_MISSION_SIZE, Math.max(MIN_MISSION_SIZE, Math.round(v))));
              }}
              className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/80"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setMissionCompleteDialogOpen(false)}>
              No, gracias
            </Button>
            <Button type="button" onClick={startAnotherMission}>
              Sí, comenzar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-6 [-webkit-overflow-scrolling:touch]">
        {totalActivos > 0 ? (
          <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/8 to-teal-500/5 dark:from-emerald-500/12 dark:to-teal-500/8">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-slate-900 dark:text-slate-100">
                Progreso global del inventario
              </CardTitle>
              <CardDescription>
                Artículos activos que ya marcaste al menos una vez en este ciclo bimestral ({cycleInfo.cycleLabelEs}).
                Suma revisiones de todas las misiones y días (en este dispositivo).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between gap-2">
                <p className="text-3xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                  {revisadosEnCiclo}
                  <span className="text-lg font-semibold text-slate-500 dark:text-slate-500">/{totalActivos}</span>
                </p>
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{pctGlobal}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 transition-[width] duration-300"
                  style={{ width: `${pctGlobal}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 dark:from-cyan-500/10 dark:to-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-slate-900 dark:text-slate-100">Misión actual</CardTitle>
            <CardDescription>
              Artículos elegidos al azar (al iniciar el día suele ser {DEFAULT_MISSION_SIZE}; si pides otra misión,
              entre {MIN_MISSION_SIZE} y {MAX_MISSION_SIZE}). El orden es el del sorteo.
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

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full border-cyan-600/40 bg-white text-slate-800 hover:bg-cyan-50 dark:border-cyan-500/30 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={printingMission || !user?.id}
            onClick={() => void printMissionDayMovements()}
          >
            {printingMission ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Printer className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            )}
            Imprimir movimientos del día (ticket)
          </Button>
          <p className="text-center text-xs text-slate-500 dark:text-slate-500">
            Resumen térmico de tus entradas, salidas y cambios de catálogo de hoy. Al terminar una misión se imprime un
            comprobante de misión completada.
          </p>
        </div>

        {totalActivos > 0 ? (
          <Card className="border-slate-200/80 dark:border-slate-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-slate-900 dark:text-slate-100">
                Contexto del ciclo (~{cycleInfo.daysInCycle} días)
              </CardTitle>
              <CardDescription>
                Día {cycleInfo.dayIndex + 1} de {cycleInfo.daysInCycle} en el calendario del ciclo. El progreso global
                arriba es la referencia principal para cubrir todo el catálogo.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="mision-buscar" className="text-slate-600 dark:text-slate-400">
            Buscar en la lista de esta misión
          </Label>
          <Input
            id="mision-buscar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, SKU o código de barras…"
            className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/80"
          />
        </div>

        {loading || !missionsReady ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-600 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando misión…
          </div>
        ) : total === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            No hay productos activos en catálogo para armar la misión en esta sucursal.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const isDone = done.has(p.id);
              return (
                <li key={p.id} className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    className={cn(
                      'flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors sm:items-center sm:px-4',
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
                  {canEditProducto ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto shrink-0 flex-col gap-0.5 border-slate-300 px-2 py-2 text-[11px] dark:border-slate-600"
                      title="Corregir existencia o datos en Inventario"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('/inventario', { state: { editProductId: p.id } });
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </Button>
                  ) : null}
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
