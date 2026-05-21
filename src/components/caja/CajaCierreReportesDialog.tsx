import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleDollarSign, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import type { CajaSesion, Sale } from '@/types';
import { listCajaSesionesFirestore } from '@/lib/firestore/cajaFirestore';
import { fetchSalesByCajaSesion } from '@/lib/firestore/salesFirestore';
import {
  computeCajaEfectivoEsperado,
  computeSesionCierreMetrics,
  efectivoEsperadoCajaSesion,
  filterVentasCompletadasSesion,
  type SesionCierreMetrics,
} from '@/lib/cajaResumen';
import { printThermalCajaCierre } from '@/lib/printTicket';

/** Por encima del menú móvil (Sheet z-[181]) y del Dialog por defecto (z-[121]). */
const CAJA_CIERRE_DIALOG_OVERLAY_Z = '!z-[240] bg-black/60';
const CAJA_CIERRE_DIALOG_CONTENT_Z = '!z-[241]';

export function CajaCierreReportesIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn('relative inline-flex h-5 w-5 shrink-0 items-center justify-center', className)}
      aria-hidden
    >
      <CircleDollarSign className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
      <Clock
        className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-[2px] bg-white dark:bg-slate-900"
        strokeWidth={2.25}
      />
    </span>
  );
}

type CajaCierreReportesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sucursalId: string | null;
  sucursalLabel?: string;
};

function sesionFechaLabel(s: CajaSesion): string {
  return formatInAppTimezone(s.openedAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function sesionHoraApertura(s: CajaSesion): string {
  return formatInAppTimezone(s.openedAt, { timeStyle: 'short' });
}

function sesionHoraCierre(s: CajaSesion): string {
  if (s.estado === 'abierta' || !s.closedAt) return '—';
  return formatInAppTimezone(s.closedAt, { timeStyle: 'short' });
}

function MetricRow({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/40">
      <span className="text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span
        className={cn('text-xs font-semibold leading-tight tabular-nums text-slate-900 dark:text-slate-100', valueClassName)}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-[9px] leading-snug text-slate-500 dark:text-slate-500">{hint}</span>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

function SesionDetallePanel({
  sesion,
  metrics,
  ventas,
  sucursalId,
  sucursalLabel,
}: {
  sesion: CajaSesion;
  metrics: SesionCierreMetrics;
  ventas: Sale[];
  sucursalId: string;
  sucursalLabel?: string;
}) {
  const completadas = metrics.tickets;
  const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(
    sesion.fondoInicial,
    filterVentasCompletadasSesion(ventas)
  );
  const esperadoCalc = efectivoEsperadoCajaSesion(
    esperadoBruto,
    sesion.aportesEfectivoTotal,
    sesion.retirosEfectivoTotal
  );
  const esperadoShow = sesion.efectivoEsperado ?? esperadoCalc;
  const esperadoStored = sesion.efectivoEsperado;
  const diferencia = sesion.diferencia;
  const declarado = sesion.conteoDeclarado;

  const handlePrint = () => {
    if (sesion.estado !== 'cerrada' || declarado == null || esperadoStored == null || diferencia == null) {
      return;
    }
    printThermalCajaCierre({
      fechaLabel: sesionFechaLabel(sesion),
      sucursalId,
      ventas,
      fondoInicial: sesion.fondoInicial,
      conteoDeclarado: declarado,
      efectivoEsperado: esperadoStored,
      diferencia,
      ticketsCompletados: sesion.ticketsCompletados ?? metrics.tickets,
      totalVentasBruto: sesion.totalVentasBruto ?? metrics.totalVentasBruto,
      abiertaPor: sesion.openedByNombre,
      cerradaPor: sesion.closedByNombre ?? '—',
      aperturaLabel: `${sesionFechaLabel(sesion)} ${sesionHoraApertura(sesion)}`,
      cierreLabel: sesion.closedAt
        ? formatInAppTimezone(sesion.closedAt, { dateStyle: 'short', timeStyle: 'short' })
        : '—',
      aportesEfectivoTotal: sesion.aportesEfectivoTotal,
      aportesEfectivo: sesion.aportesEfectivo,
      retirosEfectivoTotal: sesion.retirosEfectivoTotal,
      retirosEfectivo: sesion.retirosEfectivo,
    });
  };

  return (
    <div className="space-y-2 pr-0.5">
      <div className="flex flex-wrap items-start justify-between gap-1.5 border-b border-slate-200/70 pb-2 dark:border-slate-800/50">
        <div>
          <p className="text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
            {sesionFechaLabel(sesion)}
          </p>
          {sucursalLabel ? (
            <p className="text-[11px] text-slate-600 dark:text-slate-400">{sucursalLabel}</p>
          ) : null}
          <p className="font-mono text-[9px] text-slate-500 dark:text-slate-500">ID {sesion.id.slice(0, 12)}…</p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
            sesion.estado === 'abierta'
              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
              : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          )}
        >
          {sesion.estado === 'abierta' ? 'Caja abierta' : 'Cerrada'}
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:gap-x-6 xl:gap-x-8">
        <div className="space-y-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <MetricRow label="Apertura" value={sesionHoraApertura(sesion)} hint={sesion.openedByNombre} />
        <MetricRow
          label="Cierre"
          value={sesionHoraCierre(sesion)}
          hint={sesion.closedByNombre?.trim() || (sesion.estado === 'abierta' ? 'Turno en curso' : '—')}
        />
      </div>

      <div>
        <SectionTitle>Ventas del turno</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          <MetricRow label="Tickets cobrados" value={String(completadas)} />
          <MetricRow label="Total vendido" value={formatMoney(metrics.totalVentasBruto)} />
          <MetricRow
            label="Saldo pendiente (CxC)"
            value={formatMoney(metrics.saldoPendiente)}
            valueClassName={
              metrics.saldoPendiente > 0.005 ? 'text-amber-700 dark:text-amber-400' : undefined
            }
            hint="PPD / cobros parciales en el turno"
          />
          {metrics.ventasPendientes > 0 ? (
            <MetricRow
              label="Ventas abiertas (fiado)"
              value={String(metrics.ventasPendientes)}
              hint="Sin cobrar en este turno"
            />
          ) : null}
          {metrics.ventasCanceladas > 0 ? (
            <MetricRow label="Ventas canceladas" value={String(metrics.ventasCanceladas)} />
          ) : null}
        </div>
      </div>

      <div>
        <SectionTitle>Cobros por medio de pago</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-3">
          <MetricRow
            label="Efectivo (cobros)"
            value={formatMoney(metrics.efectivoCobros)}
            hint={`Neto ventas ${formatMoney(metrics.efectivoNetoVentas)} · Cambio ${formatMoney(metrics.cambioEntregado)}`}
          />
          <MetricRow label="Tarjetas" value={formatMoney(metrics.tarjetas)} />
          <MetricRow label="Otros medios" value={formatMoney(metrics.otros)} />
        </div>
        {metrics.lineasMedio.length > 0 ? (
          <ul className="mt-1 grid gap-0.5 rounded-md border border-slate-200/80 bg-white/60 px-2 py-1 text-[10px] dark:border-slate-800/60 dark:bg-slate-900/30 sm:grid-cols-2">
            {metrics.lineasMedio.map((row) => (
              <li key={row.clave} className="flex justify-between gap-2">
                <span className="truncate text-slate-600 dark:text-slate-400">{row.label}</span>
                <span className="shrink-0 tabular-nums font-medium text-slate-800 dark:text-slate-200">
                  {formatMoney(row.monto)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
        </div>

        <div className="space-y-2">
      <div>
        <SectionTitle>Arqueo de efectivo</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          <MetricRow label="Fondo inicial" value={formatMoney(sesion.fondoInicial)} />
          <MetricRow
            label="Aportes de efectivo"
            value={formatMoney(sesion.aportesEfectivoTotal ?? 0)}
          />
          <MetricRow
            label="Retiros de efectivo"
            value={formatMoney(sesion.retirosEfectivoTotal ?? 0)}
          />
          <MetricRow
            label="Efectivo esperado"
            value={formatMoney(esperadoShow)}
            valueClassName="text-emerald-800 dark:text-emerald-300"
          />
          {sesion.estado === 'cerrada' && declarado != null ? (
            <>
              <MetricRow label="Conteo físico" value={formatMoney(declarado)} />
              <MetricRow
                label="Diferencia"
                value={formatMoney(diferencia ?? 0)}
                valueClassName={
                  (diferencia ?? 0) > 0.005
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : (diferencia ?? 0) < -0.005
                      ? 'text-red-600 dark:text-red-400'
                      : undefined
                }
                hint="Declarado − esperado"
              />
            </>
          ) : null}
        </div>
      </div>

      {(sesion.aportesEfectivo?.length ?? 0) > 0 || (sesion.retirosEfectivo?.length ?? 0) > 0 ? (
        <div className="grid gap-1.5 lg:grid-cols-2">
          {(sesion.aportesEfectivo?.length ?? 0) > 0 ? (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/[0.06] px-2 py-1.5 dark:border-sky-500/25 dark:bg-sky-950/30">
              <SectionTitle>Detalle aportes</SectionTitle>
              <ul className="space-y-0.5 text-[10px] leading-snug text-sky-950/90 dark:text-sky-100/90">
                {[...(sesion.aportesEfectivo ?? [])]
                  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                  .map((r) => (
                    <li key={r.id}>
                      <span className="font-semibold tabular-nums">+{formatMoney(r.monto)}</span>
                      <span className="text-sky-900/80 dark:text-sky-200/80">
                        {' '}
                        · {formatInAppTimezone(r.createdAt, { timeStyle: 'short' })} · {r.usuarioNombre}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {(sesion.retirosEfectivo?.length ?? 0) > 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5 dark:border-amber-500/25 dark:bg-amber-950/25">
              <SectionTitle>Detalle retiros</SectionTitle>
              <ul className="space-y-0.5 text-[10px] leading-snug text-amber-950/90 dark:text-amber-100/90">
                {[...(sesion.retirosEfectivo ?? [])]
                  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                  .map((r) => (
                    <li key={r.id}>
                      <span className="font-semibold tabular-nums">−{formatMoney(r.monto)}</span>
                      <span>
                        {' '}
                        · {formatInAppTimezone(r.createdAt, { timeStyle: 'short' })} · {r.usuarioNombre}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {sesion.notasCierre?.trim() ? (
        <div className="rounded-md border border-slate-200/80 bg-slate-50/80 px-2 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/40">
          <SectionTitle>Notas de cierre</SectionTitle>
          <p className="text-xs leading-snug text-slate-800 dark:text-slate-200">{sesion.notasCierre.trim()}</p>
        </div>
      ) : null}

      {sesion.estado === 'cerrada' && declarado != null && esperadoStored != null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-slate-300 text-xs dark:border-slate-600"
          onClick={handlePrint}
        >
          Reimprimir ticket de cierre
        </Button>
      ) : null}
        </div>
      </div>
    </div>
  );
}

export function CajaCierreReportesDialog({
  open,
  onOpenChange,
  sucursalId,
  sucursalLabel,
}: CajaCierreReportesDialogProps) {
  const [sesiones, setSesiones] = useState<CajaSesion[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SesionCierreMetrics | null>(null);
  const [ventasDetalle, setVentasDetalle] = useState<Sale[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const selected = useMemo(
    () => sesiones.find((s) => s.id === selectedId) ?? null,
    [sesiones, selectedId]
  );

  const loadList = useCallback(async () => {
    if (!sucursalId) {
      setSesiones([]);
      setListError('Seleccione una tienda para ver el historial de cierres.');
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const rows = await listCajaSesionesFirestore(sucursalId, { limit: 100 });
      setSesiones(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'No se pudo cargar el historial');
      setSesiones([]);
    } finally {
      setListLoading(false);
    }
  }, [sucursalId]);

  useEffect(() => {
    if (!open) return;
    void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open || !sucursalId || !selectedId || !selected) {
      setMetrics(null);
      setVentasDetalle([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const ventas = await fetchSalesByCajaSesion(sucursalId, selectedId);
        if (cancelled) return;
        setVentasDetalle(ventas);
        setMetrics(computeSesionCierreMetrics(selected, ventas));
      } catch {
        if (!cancelled) {
          setMetrics(null);
          setVentasDetalle([]);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sucursalId, selectedId, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        useDialogDescription
        overlayClassName={CAJA_CIERRE_DIALOG_OVERLAY_Z}
        className={cn(
          CAJA_CIERRE_DIALOG_CONTENT_Z,
          'flex !max-w-[min(calc(100vw-2rem),96rem)] max-h-[min(82dvh,calc(100dvh-2rem))] w-[min(calc(100vw-2rem),96rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 dark:border-slate-800 dark:bg-slate-900 md:!max-w-[min(calc(100vw-3rem),96rem)] md:w-[min(calc(100vw-3rem),96rem)]'
        )}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200/80 px-4 py-2 dark:border-slate-800/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-2.5">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <CajaCierreReportesIcon />
              Reportes de cierre de caja
            </DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Historial de turnos: apertura, cierre, ventas por medio de pago, arqueo y saldos pendientes.
              {sucursalLabel ? ` Tienda: ${sucursalLabel}.` : null}
            </DialogDescription>
          </div>
        </DialogHeader>

        {!sucursalId ? (
          <p className="px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
            Elija una sucursal en el selector del encabezado para consultar cierres.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row sm:items-stretch">
            <div className="flex max-h-[32dvh] min-h-0 shrink-0 flex-col border-b border-slate-200/80 dark:border-slate-800/60 sm:max-h-none sm:h-auto sm:w-44 sm:border-b-0 sm:border-r md:w-48 lg:w-52 xl:w-56">
              <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Turnos</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={listLoading}
                  onClick={() => void loadList()}
                  aria-label="Actualizar lista"
                >
                  <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 lg:pb-3">
                {listLoading && sesiones.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando…
                  </div>
                ) : listError ? (
                  <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">{listError}</p>
                ) : sesiones.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">
                    No hay sesiones de caja registradas en esta tienda.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {sesiones.map((s) => {
                      const active = s.id === selectedId;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(s.id)}
                            className={cn(
                              'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                              active
                                ? 'border-cyan-500/50 bg-cyan-500/10 dark:border-cyan-500/40 dark:bg-cyan-500/15'
                                : 'border-slate-200/80 bg-white/70 hover:bg-slate-200/60 dark:border-slate-800/60 dark:bg-slate-900/50 dark:hover:bg-slate-800/80'
                            )}
                          >
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                              {sesionFechaLabel(s)}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-500">
                              {sesionHoraApertura(s)} → {sesionHoraCierre(s)}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                  s.estado === 'abierta'
                                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                )}
                              >
                                {s.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
                              </span>
                              {s.totalVentasBruto != null && s.totalVentasBruto > 0 ? (
                                <span className="text-[10px] tabular-nums text-cyan-700 dark:text-cyan-400">
                                  {formatMoney(s.totalVentasBruto)}
                                </span>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2.5 sm:overflow-visible sm:p-4">
              {!selected ? (
                <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                  Seleccione un turno de la lista.
                </p>
              ) : detailLoading && !metrics ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Calculando resumen…
                </div>
              ) : metrics ? (
                <SesionDetallePanel
                  sesion={selected}
                  metrics={metrics}
                  ventas={ventasDetalle}
                  sucursalId={sucursalId}
                  sucursalLabel={sucursalLabel}
                />
              ) : (
                <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
                  No se pudo cargar el detalle del turno.
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type CajaCierreReportesHeaderButtonProps = {
  sucursalId: string | null;
  sucursalLabel?: string;
  className?: string;
  /** p. ej. cerrar el menú hamburguesa al abrir el popup en móvil */
  onDialogOpenChange?: (open: boolean) => void;
};

/** Botón del header (Panel): icono $ + reloj, abre historial de cierres. */
export function CajaCierreReportesHeaderButton({
  sucursalId,
  sucursalLabel,
  className,
  onDialogOpenChange,
}: CajaCierreReportesHeaderButtonProps) {
  const [open, setOpen] = useState(false);

  const handleDialogOpenChange = (next: boolean) => {
    setOpen(next);
    onDialogOpenChange?.(next);
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn(
          'h-9 w-9 shrink-0 border-slate-300 bg-white text-cyan-600 hover:bg-slate-100 hover:text-cyan-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-cyan-400 dark:hover:bg-slate-800 dark:hover:text-cyan-300',
          className
        )}
        aria-label="Reportes de cierre de caja"
        title="Reportes de cierre de caja"
        onClick={() => handleDialogOpenChange(true)}
      >
        <CajaCierreReportesIcon />
      </Button>
      <CajaCierreReportesDialog
        open={open}
        onOpenChange={handleDialogOpenChange}
        sucursalId={sucursalId}
        sucursalLabel={sucursalLabel}
      />
    </>
  );
}
