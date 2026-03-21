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
import {
  fetchChecadorByQuincena,
  punchCierre,
  punchEntrada,
  punchRegresoComer,
  punchSalidaComer,
  reiniciarJornadaMismoDia,
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
import type { ChecadorDiaRegistro, Sucursal } from '@/types';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';

type PunchKind = 'entrada' | 'salidaComer' | 'regresoComer' | 'cierre' | 'reinicio';

export function Checador() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();

  const canRegistrar = hasPermission('checador:registrar');
  const canReporte = hasPermission('checador:reporte');

  const [todayRow, setTodayRow] = useState<ChecadorDiaRegistro | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);
  const [busy, setBusy] = useState<PunchKind | null>(null);

  const [quincenaSel, setQuincenaSel] = useState(() => getCurrentQuincenaId());
  const [reportRows, setReportRows] = useState<ChecadorDiaRegistro[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [sucursalesList, setSucursalesList] = useState<Sucursal[]>([]);

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
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    void fetchChecadorByQuincena(quincenaSel)
      .then((rows) => {
        if (!cancelled) setReportRows(rows);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'Error al cargar reporte',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quincenaSel, canReporte, user?.id, addToast]);

  const runPunch = useCallback(
    async (kind: PunchKind) => {
      if (!user) return;
      setBusy(kind);
      try {
        switch (kind) {
          case 'entrada':
            await punchEntrada(user);
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
    [user, addToast]
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
    d ? <span className="font-mono text-slate-200">{formatTimeMx(d)}</span> : <span className="text-slate-600">—</span>;

  if (!user?.isActive) {
    return (
      <PageShell title="Checador" subtitle="Asistencia">
        <p className="text-sm text-slate-400">Cuenta inactiva.</p>
      </PageShell>
    );
  }

  if (!canRegistrar) {
    return (
      <PageShell title="Checador" subtitle="Asistencia">
        <p className="text-sm text-slate-400">No tiene permiso para usar el checador.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Checador"
      subtitle={`Fecha de trabajo (Hermosillo, Son.): ${formatDateKeyMx(dateKey)} · ${formatQuincenaLabel(quincenaIdFromDateKey(dateKey))}`}
      className="min-w-0 max-w-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:gap-4">
        <Card className="w-full shrink-0 border-slate-800/50 bg-slate-900/50 lg:max-w-xl lg:self-start">
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-slate-100">
              <Clock className="h-5 w-5 text-cyan-400" />
              Mi jornada hoy
            </CardTitle>
            <p className="text-xs text-slate-500">
              Horarios en hora de Hermosillo, Sonora. Toque cada acción en orden; puede cerrar el día
              sin comida (sin usar salida/regreso).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingSub ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando registro…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-slate-500">Entrada</p>
                    {timeCell(todayRow?.entrada ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-slate-500">Salida comer</p>
                    {timeCell(todayRow?.salidaComer ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-slate-500">Regreso</p>
                    {timeCell(todayRow?.regresoComer ?? null)}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-slate-500">Cierre</p>
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
                      className="h-12 w-full border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                      onClick={async () => {
                        if (!user) return;
                        setBusy('reinicio');
                        try {
                          await reiniciarJornadaMismoDia(user);
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
          <Card className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
            <CardHeader className="flex shrink-0 flex-col gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle className="text-base text-slate-100">Registros por quincena</CardTitle>
                <p className="text-xs text-slate-500">
                  Vista de administrador: colaborador, contacto, tienda asignada al fichaje y horarios del
                  periodo.
                </p>
              </div>
              <div className="w-full min-w-[14rem] sm:w-72">
                <Label className="text-xs text-slate-500">Quincena</Label>
                <Select value={quincenaSel} onValueChange={setQuincenaSel}>
                  <SelectTrigger className="mt-1 border-slate-700 bg-slate-800 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-800 bg-slate-900">
                    {quincenaOptions.map((id) => (
                      <SelectItem key={id} value={id} className="text-slate-100">
                        {formatQuincenaLabel(id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto overscroll-contain p-2 sm:p-4 sm:pt-0">
              {reportLoading ? (
                <p className="flex items-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando…
                </p>
              ) : (
                <Table>
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:bg-slate-950 [&_th]:shadow-[0_1px_0_0_rgb(30_41_59)]">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="text-slate-400">Colaborador</TableHead>
                      <TableHead className="min-w-[10rem] text-slate-400">Correo</TableHead>
                      <TableHead className="whitespace-nowrap text-slate-400">ID usuario</TableHead>
                      <TableHead className="text-slate-400">Tienda (fichaje)</TableHead>
                      <TableHead className="text-slate-400">Fecha</TableHead>
                      <TableHead className="text-slate-400">Entrada</TableHead>
                      <TableHead className="text-slate-400">Salida a comer</TableHead>
                      <TableHead className="text-slate-400">Regreso</TableHead>
                      <TableHead className="text-slate-400">Cierre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-slate-500">
                          Sin registros en esta quincena.
                        </TableCell>
                      </TableRow>
                    ) : (
                      reportRows.map((row) => (
                        <TableRow key={row.id} className="border-slate-800/80">
                          <TableCell className="font-medium text-slate-200">{row.userName}</TableCell>
                          <TableCell
                            className="max-w-[14rem] truncate text-xs text-slate-400"
                            title={row.userEmail || undefined}
                          >
                            {row.userEmail?.trim() ? row.userEmail : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-slate-500" title={row.userId}>
                            {row.userId && row.userId.length > 12
                              ? `${row.userId.slice(0, 10)}…`
                              : row.userId || '—'}
                          </TableCell>
                          <TableCell className="max-w-[12rem] truncate text-xs text-slate-400" title={sucursalNombre(row.sucursalId)}>
                            {sucursalNombre(row.sucursalId)}
                          </TableCell>
                          <TableCell className="text-slate-400">{formatDateKeyMx(row.dateKey)}</TableCell>
                          <TableCell>{timeCell(row.entrada)}</TableCell>
                          <TableCell>{timeCell(row.salidaComer)}</TableCell>
                          <TableCell>{timeCell(row.regresoComer)}</TableCell>
                          <TableCell>{timeCell(row.cierre)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
