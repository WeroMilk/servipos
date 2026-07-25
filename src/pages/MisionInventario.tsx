import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, MapPin, Pencil, Printer } from 'lucide-react';
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
import { ConteoPorMueble } from '@/components/inventory/ConteoPorMueble';
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
import { printThermalDailyMission, printThermalMissionComplete } from '@/lib/printTicket';
import { userCanSeeInventoryMissions, userCanSeeMissionProgressOnly } from '@/lib/userPermissions';
import {
  createMissionStockAdjustRequest,
  loadMissionStockAdjustRequests,
  removeMissionStockAdjustRequest,
  userCanApproveMissionStockAdjust,
  userNeedsMissionStockAdjustApproval,
  type MissionStockAdjustRequest,
} from '@/lib/missionStockAdjustRequests';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

type MissionTab = 'mueble' | 'lista';

export function MisionInventario() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const { addToast } = useAppStore();
  const { products, loading, adjustStock } = useProducts();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [missionTab, setMissionTab] = useState<MissionTab>('mueble');
  const [dateKey, setDateKey] = useState(() => getMexicoDateKey());
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
  const canApproveStockAdjust = userCanApproveMissionStockAdjust(user);
  const needsStockAdjustApproval = userNeedsMissionStockAdjustApproval(user);

  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockDialogProduct, setStockDialogProduct] = useState<Product | null>(null);
  const [stockCantidadStr, setStockCantidadStr] = useState('');
  const [stockComentario, setStockComentario] = useState('');
  const [stockSaving, setStockSaving] = useState(false);
  const [pendingUncheckProduct, setPendingUncheckProduct] = useState<Product | null>(null);
  const [stockAdjustRequests, setStockAdjustRequests] = useState<MissionStockAdjustRequest[]>([]);
  const [stockAdjustRequestsLoading, setStockAdjustRequestsLoading] = useState(false);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);

  const refreshStockAdjustRequests = useCallback(async () => {
    if (!effectiveSucursalId) {
      setStockAdjustRequests([]);
      return;
    }
    setStockAdjustRequestsLoading(true);
    try {
      const doc = await loadMissionStockAdjustRequests(effectiveSucursalId);
      setStockAdjustRequests(doc.items);
    } catch (e) {
      console.warn('[MisionInventario] No se pudieron cargar ajustes pendientes:', e);
    } finally {
      setStockAdjustRequestsLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    void refreshStockAdjustRequests();
  }, [refreshStockAdjustRequests]);

  useEffect(() => {
    if (!effectiveSucursalId) return;
    const id = window.setInterval(() => {
      void refreshStockAdjustRequests();
    }, 20_000);
    return () => clearInterval(id);
  }, [effectiveSucursalId, refreshStockAdjustRequests]);

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

  const printDailyMissionTicket = useCallback(() => {
    if (!user?.id) return;
    if (misionList.length === 0) {
      addToast({ type: 'warning', message: 'No hay artículos en la misión actual.' });
      return;
    }
    printThermalDailyMission({
      fechaLabel: formatDateKeyMx(dateKey),
      sucursalId: effectiveSucursalId,
      cajeroNombre: user.name?.trim() || user.email,
      articulos: misionList.map((p) => ({
        nombre: p.nombre,
        sku: p.sku,
        existencia: Number(p.existencia) || 0,
        codigoBarras: p.codigoBarras?.trim() || undefined,
      })),
    });
  }, [user?.id, user?.name, user?.email, dateKey, effectiveSucursalId, misionList, addToast]);

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
    if (!effectiveSucursalId) {
      addToast({ type: 'error', message: 'No hay sucursal activa para registrar el ajuste.' });
      return;
    }
    const raw = stockCantidadStr.trim().replace(',', '.');
    const nueva = Number(raw);
    if (!Number.isFinite(nueva) || !Number.isInteger(nueva) || nueva < 0) {
      addToast({ type: 'error', message: 'Indique una cantidad entera válida (≥ 0).' });
      return;
    }
    const anterior = Math.trunc(Number(stockDialogProduct.existencia) || 0);
    if (nueva === anterior) {
      addToast({ type: 'info', message: 'La cantidad es igual a la del sistema; no hay cambio.' });
      return;
    }
    setStockSaving(true);
    try {
      const comentario = stockComentario.trim();
      if (needsStockAdjustApproval) {
        await createMissionStockAdjustRequest({
          sucursalId: effectiveSucursalId,
          productId: stockDialogProduct.id,
          productNombre: stockDialogProduct.nombre,
          productSku: stockDialogProduct.sku,
          cantidadAnterior: anterior,
          cantidadNueva: nueva,
          comentario,
          origen: 'mision_lista',
          solicitadoPorId: user.id,
          solicitadoPorNombre: user.name?.trim() || user.username?.trim() || user.email || 'Cajero',
        });
        addToast({
          type: 'success',
          message: 'Solicitud enviada. Pendiente de aprobación de Gabriel o Zavala.',
        });
        await refreshStockAdjustRequests();
      } else {
        await adjustStock(
          stockDialogProduct.id,
          nueva,
          'ajuste',
          `Misión inventario${comentario ? `: ${comentario}` : ''}`,
          undefined,
          user.id
        );
        addToast({ type: 'success', message: 'Existencia actualizada.' });
      }
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
  }, [
    stockDialogProduct,
    stockCantidadStr,
    stockComentario,
    user?.id,
    user?.name,
    user?.username,
    user?.email,
    adjustStock,
    addToast,
    effectiveSucursalId,
    needsStockAdjustApproval,
    refreshStockAdjustRequests,
  ]);

  const approveStockAdjustRequest = useCallback(
    async (req: MissionStockAdjustRequest) => {
      if (!effectiveSucursalId || !user?.id || !canApproveStockAdjust) return;
      setResolvingRequestId(req.id);
      try {
        const removed = await removeMissionStockAdjustRequest(effectiveSucursalId, req.id);
        if (!removed) {
          addToast({ type: 'warning', message: 'La solicitud ya no está pendiente.' });
          await refreshStockAdjustRequests();
          return;
        }
        const motivoParts = [
          'Misión inventario (aprobado)',
          removed.solicitadoPorNombre ? `por ${removed.solicitadoPorNombre}` : '',
          removed.comentario ? `: ${removed.comentario}` : '',
        ].filter(Boolean);
        await adjustStock(
          removed.productId,
          removed.cantidadNueva,
          'ajuste',
          motivoParts.join(' '),
          undefined,
          user.id
        );
        addToast({
          type: 'success',
          message: `Ajuste aprobado: ${removed.productNombre || removed.productSku}`,
        });
        await refreshStockAdjustRequests();
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo aprobar el ajuste',
        });
        await refreshStockAdjustRequests();
      } finally {
        setResolvingRequestId(null);
      }
    },
    [
      effectiveSucursalId,
      user?.id,
      canApproveStockAdjust,
      adjustStock,
      addToast,
      refreshStockAdjustRequests,
    ]
  );

  const rejectStockAdjustRequest = useCallback(
    async (req: MissionStockAdjustRequest) => {
      if (!effectiveSucursalId || !canApproveStockAdjust) return;
      setResolvingRequestId(req.id);
      try {
        const removed = await removeMissionStockAdjustRequest(effectiveSucursalId, req.id);
        if (!removed) {
          addToast({ type: 'warning', message: 'La solicitud ya no está pendiente.' });
        } else {
          addToast({
            type: 'info',
            message: `Solicitud rechazada: ${removed.productNombre || removed.productSku}`,
          });
        }
        await refreshStockAdjustRequests();
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo rechazar la solicitud',
        });
      } finally {
        setResolvingRequestId(null);
      }
    },
    [effectiveSucursalId, canApproveStockAdjust, addToast, refreshStockAdjustRequests]
  );

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

  const visibleStockAdjustRequests = useMemo(() => {
    if (canApproveStockAdjust) return stockAdjustRequests;
    if (!user?.id) return [];
    return stockAdjustRequests.filter((r) => r.solicitadoPorId === user.id);
  }, [canApproveStockAdjust, stockAdjustRequests, user?.id]);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const missionsReady =
    missionCloudReady &&
    missionPartitionKey != null &&
    (missionIds.length > 0 || (!loading && totalActivos === 0));

  return (
    <PageShell title={progressOnly ? 'Progreso de inventario' : 'Misiones de inventario'}>
      {!progressOnly ? (
        <div className="mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-800/60 dark:bg-slate-950/80">
          <button
            type="button"
            onClick={() => setMissionTab('mueble')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
              missionTab === 'mueble'
                ? 'bg-brand/15 text-brand-to dark:bg-brand/20 dark:text-brand'
                : 'text-slate-600 hover:bg-slate-200/80 dark:text-slate-500 dark:hover:bg-slate-800/50'
            )}
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            Por mueble
          </button>
          <button
            type="button"
            onClick={() => setMissionTab('lista')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
              missionTab === 'lista'
                ? 'bg-brand/15 text-brand-to dark:bg-brand/20 dark:text-brand'
                : 'text-slate-600 hover:bg-slate-200/80 dark:text-slate-500 dark:hover:bg-slate-800/50'
            )}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Lista del día
          </button>
        </div>
      ) : null}

      {visibleStockAdjustRequests.length > 0 || (canApproveStockAdjust && stockAdjustRequestsLoading) ? (
        <Card className="mb-3 shrink-0 border-amber-500/40 bg-amber-500/5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-3">
            <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {canApproveStockAdjust
                ? `Ajustes pendientes de aprobación (${visibleStockAdjustRequests.length})`
                : `Tus ajustes pendientes (${visibleStockAdjustRequests.length})`}
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void refreshStockAdjustRequests()}
              disabled={stockAdjustRequestsLoading}
            >
              {stockAdjustRequestsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Actualizar'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 pb-3">
            {visibleStockAdjustRequests.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-400">No hay solicitudes pendientes.</p>
            ) : (
              visibleStockAdjustRequests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-950/50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {req.productNombre || 'Producto'}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        SKU {req.productSku || '—'} · {req.cantidadAnterior} → {req.cantidadNueva}
                        {req.mueble ? ` · mueble ${req.mueble}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500">
                        Solicitó {req.solicitadoPorNombre}
                        {req.comentario ? ` · ${req.comentario}` : ''}
                      </p>
                    </div>
                    {canApproveStockAdjust ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={resolvingRequestId === req.id}
                          onClick={() => void rejectStockAdjustRequest(req)}
                        >
                          Rechazar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={resolvingRequestId === req.id}
                          onClick={() => void approveStockAdjustRequest(req)}
                        >
                          {resolvingRequestId === req.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Aprobar
                        </Button>
                      </div>
                    ) : (
                      <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                        Esperando encargado
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {!progressOnly && missionTab === 'mueble' ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ConteoPorMueble onPendingAdjustCreated={() => void refreshStockAdjustRequests()} />
        </div>
      ) : null}

      {progressOnly || missionTab === 'lista' ? (
        <>
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
              {needsStockAdjustApproval
                ? 'Indique la cantidad correcta y un comentario. Un encargado (Gabriel o Zavala) debe aprobar antes de modificar el inventario real.'
                : 'Cantidad correcta en sistema y comentario (p. ej. motivo del conteo). Se registra como ajuste de inventario.'}
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
              {needsStockAdjustApproval ? 'Enviar a aprobación' : 'Guardar'}
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {totalActivos > 0 ? (
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/8 to-teal-500/5 dark:from-emerald-500/12 dark:to-teal-500/8">
              <CardHeader className="px-4 pb-1 pt-3">
                <CardTitle className="text-base text-slate-900 dark:text-slate-100">
                  Progreso global del inventario
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-3">
                <div className="flex items-end justify-between gap-2">
                  <p className="text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {revisadosEnCiclo}
                    <span className="text-base font-semibold text-slate-500 dark:text-slate-500">/{totalActivos}</span>
                  </p>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{pctGlobal}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 transition-[width] duration-300"
                    style={{ width: `${pctGlobal}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!progressOnly ? (
            <Card className="border-brand/20 bg-gradient-to-br from-brand-from/5 to-brand-to/5 dark:from-brand-from/10 dark:to-brand-to/5">
              <CardHeader className="px-4 pb-1 pt-3">
                <CardTitle className="text-base text-slate-900 dark:text-slate-100">Misión actual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-3">
                <div className="flex items-end justify-between gap-2">
                  <p className="text-2xl font-bold tabular-nums text-brand-to dark:text-brand">
                    {hechos}
                    <span className="text-base font-semibold text-slate-500 dark:text-slate-500">/{total}</span>
                  </p>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {!progressOnly ? (
          <>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full border-brand/40 bg-white text-slate-800 hover:bg-brand/10 dark:border-brand/30 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={!user?.id || misionList.length === 0}
            onClick={printDailyMissionTicket}
          >
            <Printer className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            Imprimir misión diaria (ticket)
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
                      <span className="text-lg font-semibold tabular-nums text-brand-to dark:text-brand">
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
              ? needsStockAdjustApproval
                ? 'Si el stock no coincide, use Editar: la corrección quedará pendiente hasta que Gabriel o Zavala la aprueben.'
                : 'Si el stock no coincide, use Editar para ajustar la cantidad y dejar comentario. Gracias.'
              : 'Si encuentra diferencias de stock, avise a un encargado o use Inventario (si tiene permiso) para ajustar.'}
          </p>
        ) : null}
      </div>
        </>
      ) : null}
    </PageShell>
  );
}
