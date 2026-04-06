import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, Pencil, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageShell } from '@/components/ui-custom/PageShell';
import { useProducts } from '@/hooks/useProducts';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAuthStore, useAppStore } from '@/stores';
import {
  addUsedIdsToDay,
  DEFAULT_MISSION_SIZE,
  exportMissionStateForUser,
  importMissionStateForUser,
  loadMissionDoneIds,
  loadMissionProductIds,
  loadUsedIdsInDay,
  loadUsedIdsInDayAllUsers,
  MAX_MISSION_SIZE,
  mergeAllUsersMissionDoneInCycle,
  mergeMissionDoneIdsInCycle,
  MIN_MISSION_SIZE,
  newMissionPartitionKeyAfterComplete,
  pickRandomMissionIdsFromProducts,
  resolveStickyMissionPartitionKey,
  saveActiveMissionPartitionKey,
  saveMissionDoneIds,
  saveMissionProductIds,
} from '@/lib/dailyInventoryMission';
import { getUserStateDocOnce, saveUserStateDoc } from '@/lib/firestore/stateDocsFirestore';
import { formatDateKeyMx, getMexicoDateKey } from '@/lib/quincenaMx';
import { printThermalMissionComplete, printThermalMissionInventoryReport } from '@/lib/printTicket';
import {
  buildMissionDayTicketLines,
  fetchInventoryMovementsForUserMexicoDay,
} from '@/lib/missionDayInventoryMovements';
import { userCanSeeInventoryMissions, userCanSeeMissionProgressOnly } from '@/lib/userPermissions';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

export function MisionInventario() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const { addToast } = useAppStore();
  const { products, loading, adjustStock } = useProducts();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [dateKey, setDateKey] = useState(() => getMexicoDateKey());
  const [printingMission, setPrintingMission] = useState(false);
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [missionIds, setMissionIds] = useState<string[]>([]);
  const [missionCompleteDialogOpen, setMissionCompleteDialogOpen] = useState(false);
  const [nextMissionCount, setNextMissionCount] = useState(DEFAULT_MISSION_SIZE);
  const [missionPartitionKey, setMissionPartitionKey] = useState<string | null>(null);
  const [missionCloudReady, setMissionCloudReady] = useState(false);

  const fullMission = userCanSeeInventoryMissions(user);
  const progressOnly = userCanSeeMissionProgressOnly(user);
  const allowed = fullMission || progressOnly;
  const canEditProducto = hasPermission('inventario:editar');
  const canAdjustStockMission = hasPermission('inventario:mision_ajustar_stock');

  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockDialogProduct, setStockDialogProduct] = useState<Product | null>(null);
  const [stockCantidadStr, setStockCantidadStr] = useState('');
  const [stockComentario, setStockComentario] = useState('');
  const [stockSaving, setStockSaving] = useState(false);
  const [pendingUncheckProduct, setPendingUncheckProduct] = useState<Product | null>(null);

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
    setMissionCloudReady(false);
    if (!user?.id || !effectiveSucursalId) {
      setMissionCloudReady(true);
      return;
    }
    let cancelled = false;
    void getUserStateDocOnce<{
      activePartitionKey: string | null;
      partitions: Record<string, { doneIds: string[]; productIds: string[]; usedIds: string[] }>;
    }>(effectiveSucursalId, user.id, 'inventory_mission_state')
      .then((doc) => {
        if (cancelled) return;
        importMissionStateForUser(user.id, doc ?? undefined);
      })
      .catch((e) => {
        console.warn('[MisionInventario] No se pudo cargar estado nube de misión:', e);
      })
      .finally(() => {
        if (!cancelled) setMissionCloudReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, effectiveSucursalId]);

  useEffect(() => {
    if (!missionCloudReady) return;
    if (!user?.id || !effectiveSucursalId) return;
    const t = window.setTimeout(() => {
      const doc = exportMissionStateForUser(user.id);
      void saveUserStateDoc(effectiveSucursalId, user.id, 'inventory_mission_state', doc).catch((e) => {
        console.warn('[MisionInventario] No se pudo guardar estado nube de misión:', e);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [missionCloudReady, user?.id, effectiveSucursalId, missionPartitionKey, missionIds, done]);

  useEffect(() => {
    if (progressOnly) {
      setMissionPartitionKey(null);
      return;
    }
    if (!user?.id || products.length === 0) return;
    const key = resolveStickyMissionPartitionKey(user.id, products, dateKey);
    setMissionPartitionKey(key);
  }, [progressOnly, user?.id, products, dateKey, missionCloudReady]);

  useEffect(() => {
    if (!user?.id || !missionPartitionKey) return;
    setDone(loadMissionDoneIds(user.id, missionPartitionKey));
  }, [user?.id, missionPartitionKey]);

  useEffect(() => {
    if (progressOnly) {
      setMissionIds([]);
      return;
    }
    if (!user?.id || !missionPartitionKey || products.length === 0) return;
    const activeIds = new Set(products.filter((p) => p.activo !== false).map((p) => p.id));
    if (activeIds.size === 0) {
      setMissionIds([]);
      return;
    }
    const stored = loadMissionProductIds(user.id, missionPartitionKey);
    if (stored && stored.length > 0) {
      const valid = stored.filter((id) => activeIds.has(id));
      if (valid.length > 0) {
        setMissionIds(valid);
        return;
      }
    }
    const used = loadUsedIdsInDay(user.id, missionPartitionKey);
    const usedGlobal = loadUsedIdsInDayAllUsers(missionPartitionKey);
    usedGlobal.forEach((id) => used.add(id));
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID ?
        crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const ids = pickRandomMissionIdsFromProducts(products, DEFAULT_MISSION_SIZE, used, seed);
    saveMissionProductIds(user.id, missionPartitionKey, ids);
    setMissionIds(ids);
  }, [progressOnly, user?.id, missionPartitionKey, products, missionCloudReady]);

  const misionList = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return missionIds.map((id) => map.get(id)).filter((p): p is Product => p != null);
  }, [missionIds, products]);

  const totalActivos = useMemo(
    () => products.filter((p) => p.activo !== false).length,
    [products]
  );

  const revisadosEnCiclo = useMemo(() => {
    const activos = new Set(products.filter((p) => p.activo !== false).map((p) => p.id));
    const merged = progressOnly
      ? mergeAllUsersMissionDoneInCycle(dateKey)
      : user?.id
        ? mergeMissionDoneIdsInCycle(user.id, dateKey)
        : new Set<string>();
    let n = 0;
    merged.forEach((id) => {
      if (activos.has(id)) n++;
    });
    return n;
  }, [progressOnly, user?.id, dateKey, products]);

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
      Math.max(MIN_MISSION_SIZE, Number.isFinite(raw) ? Math.round(raw) : DEFAULT_MISSION_SIZE)
    );
    const newPk = newMissionPartitionKeyAfterComplete();
    const used = loadUsedIdsInDay(user.id, newPk);
    const usedGlobal = loadUsedIdsInDayAllUsers(newPk);
    usedGlobal.forEach((id) => used.add(id));
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID ?
        crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const ids = pickRandomMissionIdsFromProducts(products, n, used, seed);
    if (ids.length === 0) {
      addToast({ type: 'warning', message: 'No hay artículos activos para armar otra misión.' });
      return;
    }
    saveActiveMissionPartitionKey(user.id, newPk);
    setMissionPartitionKey(newPk);
    if (ids.length < n) {
      addToast({
        type: 'info',
        message: `Solo había ${ids.length} artículo(s) disponibles sin repetir lo ya sorteado en esta misión; se asignó la lista completa.`,
      });
    }
    saveMissionProductIds(user.id, newPk, ids);
    setMissionIds(ids);
    setDone(new Set());
    setMissionCompleteDialogOpen(false);
  }, [user?.id, products, nextMissionCount, addToast]);

  const openStockAdjustDialog = useCallback((p: Product) => {
    setStockDialogProduct(p);
    setStockCantidadStr(String(Math.trunc(Number(p.existencia) || 0)));
    setStockComentario('');
    setStockDialogOpen(true);
  }, []);

  const submitStockAdjust = useCallback(async () => {
    if (!stockDialogProduct || !user?.id) return;
    const raw = stockCantidadStr.trim().replace(',', '.');
    const nueva = Number(raw);
    if (!Number.isFinite(nueva) || !Number.isInteger(nueva)) {
      addToast({ type: 'error', message: 'Indique una cantidad entera válida.' });
      return;
    }
    setStockSaving(true);
    try {
      await adjustStock(
        stockDialogProduct.id,
        nueva,
        'ajuste',
        `Misión inventario${stockComentario.trim() ? `: ${stockComentario.trim()}` : ''}`,
        undefined,
        user.id
      );
      addToast({ type: 'success', message: 'Existencia actualizada.' });
      setStockDialogOpen(false);
      setStockDialogProduct(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar el ajuste',
      });
    } finally {
      setStockSaving(false);
    }
  }, [stockDialogProduct, stockCantidadStr, stockComentario, user?.id, adjustStock, addToast]);

  const applyToggleCheck = useCallback(
    (p: Product) => {
      if (!user?.id || !missionPartitionKey) return;
      setDone((prev) => {
        const next = new Set(prev);
        const wasAllDone = misionList.length > 0 && misionList.every((x) => prev.has(x.id));
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        saveMissionDoneIds(user.id, missionPartitionKey, next);
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
            addUsedIdsToDay(user.id, missionPartitionKey, completedIds);
            if (effectiveSucursalId) {
              const doc = exportMissionStateForUser(user.id);
              void saveUserStateDoc(effectiveSucursalId, user.id, 'inventory_mission_state', doc).catch(() => {
                /* noop */
              });
            }
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
      missionPartitionKey,
      misionList,
      addToast,
      dateKey,
      effectiveSucursalId,
    ]
  );

  const toggle = useCallback(
    (p: Product) => {
      if (done.has(p.id)) {
        setPendingUncheckProduct(p);
        return;
      }
      applyToggleCheck(p);
    },
    [done, applyToggleCheck]
  );

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const missionsReady =
    missionCloudReady &&
    missionPartitionKey != null &&
    (missionIds.length > 0 || (!loading && totalActivos === 0));

  return (
    <PageShell title={progressOnly ? 'Progreso de inventario' : 'Misiones de inventario'}>
      <AlertDialog
        open={pendingUncheckProduct != null}
        onOpenChange={(open) => {
          if (!open) setPendingUncheckProduct(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar check del artículo?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              Se marcará otra vez como pendiente en esta misión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingUncheckProduct ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-left">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {pendingUncheckProduct.nombre}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                SKU {pendingUncheckProduct.sku}
              </p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400"
              onClick={() => {
                if (pendingUncheckProduct) applyToggleCheck(pendingUncheckProduct);
                setPendingUncheckProduct(null);
              }}
            >
              Sí, quitar check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={stockDialogOpen} onOpenChange={(o) => {
        setStockDialogOpen(o);
        if (!o) setStockDialogProduct(null);
      }}>
        <DialogContent className="sm:max-w-md" useDialogDescription>
          <DialogHeader>
            <DialogTitle>Ajustar existencia</DialogTitle>
            <DialogDescription>
              Cantidad correcta en sistema y comentario (p. ej. motivo del conteo). Se registra como ajuste de inventario.
            </DialogDescription>
          </DialogHeader>
          {stockDialogProduct ? (
            <div className="space-y-3 py-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{stockDialogProduct.nombre}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">SKU {stockDialogProduct.sku}</p>
              <div className="space-y-1">
                <Label htmlFor="mision-stock-cantidad">Cantidad correcta</Label>
                <Input
                  id="mision-stock-cantidad"
                  type="number"
                  inputMode="numeric"
                  value={stockCantidadStr}
                  onChange={(e) => setStockCantidadStr(e.target.value)}
                  className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/80"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mision-stock-comentario">Comentario</Label>
                <textarea
                  id="mision-stock-comentario"
                  value={stockComentario}
                  onChange={(e) => setStockComentario(e.target.value)}
                  rows={3}
                  placeholder="Ej. conteo físico, rotura, hallazgo en anaquel…"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setStockDialogOpen(false)} disabled={stockSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitStockAdjust()} disabled={stockSaving || !stockDialogProduct}>
              {stockSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <div className="flex min-h-0 w-full max-w-none flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-6 [-webkit-overflow-scrolling:touch]">
        {totalActivos > 0 ? (
          <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/8 to-teal-500/5 dark:from-emerald-500/12 dark:to-teal-500/8">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-slate-900 dark:text-slate-100">
                Progreso global del inventario
              </CardTitle>
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

        {!progressOnly ? (
          <>
        <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 dark:from-cyan-500/10 dark:to-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-slate-900 dark:text-slate-100">Misión actual</CardTitle>
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
        </div>
          </>
        ) : null}

        {!progressOnly ? (
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
        ) : null}

        {!progressOnly && (loading || !missionsReady) ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-600 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando misión…
          </div>
        ) : !progressOnly && total === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            No hay productos activos en catálogo para armar la misión en esta sucursal.
          </p>
        ) : !progressOnly ? (
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
                  {canAdjustStockMission || canEditProducto ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto shrink-0 flex-col gap-0.5 border-slate-300 px-2 py-2 text-[11px] dark:border-slate-600"
                      title={
                        canAdjustStockMission
                          ? 'Corregir cantidad en sistema y comentario'
                          : 'Abrir ficha en Inventario'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canAdjustStockMission) {
                          openStockAdjustDialog(p);
                        } else {
                          navigate('/inventario', { state: { editProductId: p.id } });
                        }
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
        ) : null}

        {!progressOnly && filtered.length === 0 && total > 0 && query.trim() ? (
          <p className="text-center text-sm text-slate-500 dark:text-slate-500">Ningún artículo coincide con la búsqueda.</p>
        ) : null}

        {!progressOnly && total > 0 ? (
          <p className="text-center text-xs leading-relaxed text-slate-500 dark:text-slate-500">
            {canAdjustStockMission
              ? 'Si el stock no coincide, use Editar para ajustar la cantidad y dejar comentario. Gracias.'
              : 'Si encuentra diferencias de stock, avise a un encargado o use Inventario (si tiene permiso) para ajustar.'}
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
