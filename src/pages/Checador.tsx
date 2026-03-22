import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageShell } from '@/components/ui-custom/PageShell';
import { useAuthStore, useAppStore } from '@/stores';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { subscribeFirestoreDirectoryUsers } from '@/lib/firestore/usersDirectoryFirestore';
import {
  filterChecadorRowsBySucursal,
  punchCierre,
  punchEntrada,
  punchRegresoComer,
  punchSalidaComer,
  reiniciarJornadaMismoDia,
  subscribeChecadorByQuincena,
  subscribeChecadorDia,
} from '@/lib/firestore/checadorFirestore';
import {
  formatDateKeyMx,
  formatQuincenaLabel,
  formatTimeMx,
  getCurrentQuincenaId,
  getMexicoDateKey,
  quincenaIdFromDateKey,
  recentQuincenaIds,
} from '@/lib/quincenaMx';
import type { ChecadorDiaRegistro, Sucursal, User } from '@/types';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';

type PunchKind = 'entrada' | 'salidaComer' | 'regresoComer' | 'cierre' | 'reinicio';

export function Checador() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const canRegistrar = hasPermission('checador:registrar');
  const canReporte = hasPermission('checador:reporte');

  const [todayRow, setTodayRow] = useState<ChecadorDiaRegistro | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);
  const [busy, setBusy] = useState<PunchKind | null>(null);

  const [quincenaSel, setQuincenaSel] = useState(() => getCurrentQuincenaId());
  const [reportRows, setReportRows] = useState<ChecadorDiaRegistro[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [sucursalesList, setSucursalesList] = useState<Sucursal[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);

  const [dateKey, setDateKey] = useState(() => getMexicoDateKey());
  const quincenaOptions = useMemo(() => recentQuincenaIds(12), []);

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
    if (!user?.id || !canRegistrar) {
      setTodayRow(null);
      setLoadingSub(false);
      return;
    }
    setLoadingSub(true);
    const unsub = subscribeChecadorDia(user.id, dateKey, (row) => {
      setTodayRow(row);
      setLoadingSub(false);
    });
    return unsub;
  }, [user?.id, dateKey, canRegistrar]);

  useEffect(() => {
    if (!canReporte) return;
    return subscribeSucursales(setSucursalesList);
  }, [canReporte]);

  useEffect(() => {
    if (!canReporte) return;
    return subscribeFirestoreDirectoryUsers(setDirectoryUsers);
  }, [canReporte]);

  const sucursalNombre = useCallback(
    (id?: string | null) => {
      if (!id?.trim()) return '—';
      const hit = sucursalesList.find((s) => s.id === id);
      return hit?.nombre ? `${hit.nombre} (${id})` : id;
    },
    [sucursalesList]
  );

  useEffect(() => {
    if (!canReporte || !user?.id) {
      setReportRows([]);
      setReportLoading(false);
      return;
    }
    setReportLoading(true);
    const unsub = subscribeChecadorByQuincena(quincenaSel, (rows) => {
      setReportRows(rows);
      setReportLoading(false);
    });
    return () => unsub();
  }, [quincenaSel, canReporte, user?.id]);

  const userSucursalByUid = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const u of directoryUsers) m.set(u.id, u.sucursalId);
    return m;
  }, [directoryUsers]);

  const filteredReportRows = useMemo(() => {
    const sid = effectiveSucursalId?.trim();
    if (!sid) return [];
    return filterChecadorRowsBySucursal(reportRows, sid, userSucursalByUid);
  }, [reportRows, effectiveSucursalId, userSucursalByUid]);

  const runPunch = useCallback(
    async (kind: PunchKind) => {
      if (!user) return;
      setBusy(kind);
      try {
        switch (kind) {
          case 'entrada':
            await punchEntrada(user, effectiveSucursalId);
            addToast({ type: 'success', message: 'Entrada registrada' });
            break;
          case 'salidaComer':
            await punchSalidaComer(user);
            addToast({ type: 'success', message: 'Salida a comer registrada' });
            break;
          case 'regresoComer':
            await punchRegresoComer(user);
            addToast({ type: 'success', message: 'Regreso de comer registrado' });
            break;
          case 'cierre':
            await punchCierre(user);
            addToast({ type: 'success', message: 'Jornada cerrada' });
            break;
        }
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo registrar',
        });
      } finally {
        setBusy(null);
      }
    },
    [user, addToast, effectiveSucursalId]
  );

  const ui = useMemo(() => {
    const r = todayRow;
    const entrada = !!r?.entrada;
    const salida = !!r?.salidaComer;
    const regreso = !!r?.regresoComer;
    const cerrado = !!r?.cierre;

    return {
      showEntrada: !entrada,
      showSalidaComer: entrada && !salida && !cerrado,
      showRegresoComer: salida && !regreso && !cerrado,
      showCierre:
        entrada && !cerrado && (!salida || regreso),
      cerrado,
    };
  }, [todayRow]);

  const timeCell = (d: Date | null) =>
    d ? <span className="font-mono text-slate-800 dark:text-slate-200">{formatTimeMx(d)}</span> : <span className="text-slate-600">—</span>;

  if (!user?.isActive) {
    return (
      <PageShell title="Checador" subtitle="Asistencia">
        <p className="text-sm text-slate-600 dark:text-slate-400">Cuenta inactiva.</p>
      </PageShell>
    );
  }

  if (!canRegistrar) {
    return (
      <PageShell title="Checador" subtitle="Asistencia">
        <p className="text-sm text-slate-600 dark:text-slate-400">No tiene permiso para usar el checador.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Checador"
      subtitle={`Fecha de trabajo (Hermosillo, Son.): ${formatDateKeyMx(dateKey)} · ${formatQuincenaLabel(quincenaIdFromDateKey(dateKey))}`}
      className="min-w-0 max-w-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain xl:flex-row xl:gap-4 xl:overflow-hidden">
        <Card className="w-full shrink-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 xl:max-w-xl xl:shrink-0 xl:self-start">
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-100">
              <Clock className="h-5 w-5 text-cyan-400" />
              Mi jornada hoy
            </CardTitle>
            <p className="text-xs text-slate-600 dark:text-slate-500">
              Horarios en hora de Hermosillo, Sonora. Toque cada acción en orden; puede cerrar el día
              sin comida (sin usar salida/regreso).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingSub ? (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando registro…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2">
                    <p className="text-slate-600 dark:text-slate-500">Entrada</p>
                    {timeCell(todayRow?.entrada ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2">
                    <p className="text-slate-600 dark:text-slate-500">Salida comer</p>
                    {timeCell(todayRow?.salidaComer ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2">
                    <p className="text-slate-600 dark:text-slate-500">Regreso</p>
                    {timeCell(todayRow?.regresoComer ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-2">
                    <p className="text-slate-600 dark:text-slate-500">Cierre</p>
                    {timeCell(todayRow?.cierre ?? null)}
                  </div>
                </div>

                {ui.cerrado ? (
                  <div className="space-y-3">
                    <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                      Jornada cerrada. ¡Buen descanso!
                    </p>
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      disabled={busy !== null}
                      className="h-12 w-full border-cyan-500/40 text-cyan-900 hover:bg-cyan-500/10 dark:text-cyan-300"
                      onClick={async () => {
                        if (!user) return;
                        setBusy('reinicio');
                        try {
                          await reiniciarJornadaMismoDia(user, effectiveSucursalId);
                          addToast({
                            type: 'success',
                            message: 'Puede registrar una nueva entrada hoy',
                          });
                        } catch (e) {
                          addToast({
                            type: 'error',
                            message: e instanceof Error ? e.message : 'No se pudo reiniciar',
                          });
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Iniciar jornada de nuevo (mismo día)
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {ui.showEntrada ? (
                      <Button
                        type="button"
                        size="lg"
                        disabled={busy !== null}
                        className="h-14 w-full bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-500"
                        onClick={() => void runPunch('entrada')}
                      >
                        {busy === 'entrada' ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Entrar
                      </Button>
                    ) : null}

                    {ui.showSalidaComer ? (
                      <Button
                        type="button"
                        size="lg"
                        disabled={busy !== null}
                        className="h-14 w-full bg-red-600 text-base font-semibold text-white hover:bg-red-500"
                        onClick={() => void runPunch('salidaComer')}
                      >
                        {busy === 'salidaComer' ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Salir a comer
                      </Button>
                    ) : null}

                    {ui.showRegresoComer ? (
                      <Button
                        type="button"
                        size="lg"
                        disabled={busy !== null}
                        className="h-14 w-full bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-500"
                        onClick={() => void runPunch('regresoComer')}
                      >
                        {busy === 'regresoComer' ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Regresar de comer
                      </Button>
                    ) : null}

                    {ui.showCierre ? (
                      <Button
                        type="button"
                        size="lg"
                        disabled={busy !== null}
                        className="h-14 w-full bg-red-700 text-base font-semibold text-white hover:bg-red-600"
                        onClick={() => void runPunch('cierre')}
                      >
                        {busy === 'cierre' ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Cerrar el día
                      </Button>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {canReporte ? (
          <Card className="flex w-full min-w-0 flex-col border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 max-xl:flex-none xl:min-h-0 xl:flex-1 xl:basis-0 xl:overflow-hidden">
            <CardHeader className="flex shrink-0 flex-col gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle className="text-base text-slate-900 dark:text-slate-100">Registros por quincena</CardTitle>
                <p className="break-words text-xs text-slate-600 dark:text-slate-500 [overflow-wrap:anywhere]">
                  Solo se listan fichajes de la tienda seleccionada arriba (
                  {sucursalNombre(effectiveSucursalId)}). Colaboradores de otras tiendas no aparecen. Los
                  registros antiguos sin tienda se atribuyen por la sucursal del perfil del usuario.
                </p>
              </div>
              <div className="w-full min-w-[14rem] sm:w-72">
                <Label className="text-xs text-slate-600 dark:text-slate-500">Quincena</Label>
                <Select value={quincenaSel} onValueChange={setQuincenaSel}>
                  <SelectTrigger className="mt-1 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                    {quincenaOptions.map((id) => (
                      <SelectItem key={id} value={id} className="text-slate-900 dark:text-slate-100">
                        {formatQuincenaLabel(id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto overscroll-contain p-2 sm:p-4 sm:pt-0 xl:min-h-0">
              {reportLoading ? (
                <p className="flex items-center gap-2 py-8 text-sm text-slate-600 dark:text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando…
                </p>
              ) : (
                <div className="min-w-0 max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <Table className="w-max min-w-full">
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:bg-slate-50 [&_th]:backdrop-blur-sm dark:[&_th]:bg-slate-950/95 dark:[&_th]:backdrop-blur-sm [&_th]:shadow-[0_1px_0_0_rgb(226_232_240)] dark:[&_th]:shadow-[0_1px_0_0_rgb(30_41_59)]">
                    <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                      <TableHead className="text-slate-600 dark:text-slate-300">Colaborador</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-300">Fecha</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-300">Entrada</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-300">Salida a comer</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-300">Regreso</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-300">Cierre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReportRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-600 dark:text-slate-500">
                          Sin registros en esta quincena para esta tienda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredReportRows.map((row) => (
                        <TableRow key={row.id} className="border-slate-200 dark:border-slate-800/80">
                          <TableCell className="font-medium text-slate-800 dark:text-slate-200">{row.userName}</TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">{formatDateKeyMx(row.dateKey)}</TableCell>
                          <TableCell>{timeCell(row.entrada)}</TableCell>
                          <TableCell>{timeCell(row.salidaComer)}</TableCell>
                          <TableCell>{timeCell(row.regresoComer)}</TableCell>
                          <TableCell>{timeCell(row.cierre)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
