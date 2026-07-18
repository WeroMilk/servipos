import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleDollarSign, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { getMexicoDateKey, startOfDayFromDateKey } from '@/lib/quincenaMx';
import type { CajaAbonoCobro, CajaSesion, Sale } from '@/types';
import {
  isValidCierreTerminalFolio,
  listCajaSesionesFirestore,
  registrarCierreTerminalFirestore,
} from '@/lib/firestore/cajaFirestore';
import { fetchSalesByCajaSesion, fetchSalesPoolForCajaSesion } from '@/lib/firestore/salesFirestore';
import { listAbonosHistorialByCajaSesionFirestore } from '@/lib/firestore/clientsFirestore';
import {
  computeCajaEfectivoEsperado,
  computeSesionCierreMetrics,
  efectivoEsperadoCajaSesion,
  filterVentasCompletadasSesion,
  labelFormaPagoCaja,
  resolveAbonosCobrosSesion,
  totalAbonosEfectivoSesion,
  type SesionCierreMetrics,
} from '@/lib/cajaResumen';
import { printThermalCajaCierre } from '@/lib/printTicket';
import { useAuthStore } from '@/stores';
import { useAppStore } from '@/stores';

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
  abonosCobros,
  sucursalId,
  sucursalLabel,
  onSesionUpdated,
}: {
  sesion: CajaSesion;
  metrics: SesionCierreMetrics;
  ventas: Sale[];
  abonosCobros: CajaAbonoCobro[];
  sucursalId: string;
  sucursalLabel?: string;
  onSesionUpdated?: () => void;
}) {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const [terminalTotalInput, setTerminalTotalInput] = useState('');
  const [terminalFolioInput, setTerminalFolioInput] = useState('');
  const [terminalBusy, setTerminalBusy] = useState(false);

  const completadas = metrics.tickets;
  const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(
    sesion.fondoInicial,
    filterVentasCompletadasSesion(ventas),
    sesion.id
  );
  const esperadoCalc = efectivoEsperadoCajaSesion(
    esperadoBruto,
    sesion.aportesEfectivoTotal,
    sesion.retirosEfectivoTotal,
    totalAbonosEfectivoSesion(abonosCobros)
  );
  const esperadoShow = sesion.efectivoEsperado ?? esperadoCalc;
  const esperadoStored = sesion.efectivoEsperado;
  const diferencia = sesion.diferencia;
  const declarado = sesion.conteoDeclarado;

  const cierresTerminal = sesion.cierresTerminal ?? [];
  const sumaCierres = Math.round(
    cierresTerminal.reduce((s, c) => s + (Number(c.total) || 0), 0) * 100
  ) / 100;
  const tarjetasPos = metrics.tarjetas;
  const tarjetasEsperadasShow = sesion.tarjetasEsperadas ?? tarjetasPos;
  const conteoTarjetasShow = sesion.conteoTarjetasDeclarado ?? (cierresTerminal.length ? sumaCierres : null);
  const diferenciaTarjetasShow =
    sesion.diferenciaTarjetas != null
      ? sesion.diferenciaTarjetas
      : conteoTarjetasShow != null
        ? Math.round((conteoTarjetasShow - tarjetasEsperadasShow) * 100) / 100
        : null;

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
      abonosCobros,
      cajaSesionId: sesion.id,
      tarjetasEsperadas: tarjetasEsperadasShow,
      conteoTarjetasDeclarado: conteoTarjetasShow ?? undefined,
      diferenciaTarjetas: diferenciaTarjetasShow ?? undefined,
      cierresTerminal: cierresTerminal.length ? cierresTerminal : undefined,
    });
  };

  const handleAddCierreTerminal = async () => {
    const total = parseFloat(terminalTotalInput.replace(',', '.'));
    if (!Number.isFinite(total) || total < 0) {
      addToast({ type: 'error', message: 'Indique el total del corte de terminal', logToAppEvents: true });
      return;
    }
    const folio = terminalFolioInput.trim();
    if (!isValidCierreTerminalFolio(folio)) {
      addToast({
        type: 'error',
        message: 'Indique el folio del voucher de terminal (5 dígitos)',
        logToAppEvents: true,
      });
      return;
    }
    const userId = user?.id ?? 'system';
    const userNombre = user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || 'Usuario';
    setTerminalBusy(true);
    try {
      await registrarCierreTerminalFirestore(sucursalId, sesion.id, {
        total: Math.round(total * 100) / 100,
        folio,
        usuarioId: userId,
        usuarioNombre: userNombre,
      });
      setTerminalTotalInput('');
      setTerminalFolioInput('');
      addToast({ type: 'success', message: 'Cierre de terminal registrado', logToAppEvents: true });
      onSesionUpdated?.();
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar el cierre de terminal',
        logToAppEvents: true,
      });
    } finally {
      setTerminalBusy(false);
    }
  };

  return (
    <div className="space-y-3 pb-2 pr-0.5">
      <div className="flex flex-wrap items-start justify-between gap-1.5 border-b border-slate-200/70 pb-2 dark:border-slate-800/50">
        <div className="min-w-0">
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

      <div className="grid gap-3 xl:grid-cols-2 xl:gap-x-6">
        <div className="space-y-3">
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
        <div className="grid gap-1.5 sm:grid-cols-2">
          <MetricRow label="Tickets cobrados" value={String(completadas)} />
          <MetricRow
            label="Total vendido (bruto)"
            value={formatMoney(metrics.totalVentasBruto)}
            hint="Suma de tickets del turno"
          />
          <MetricRow
            label="Total cobrado"
            value={formatMoney(metrics.totalCobrado)}
            hint="Ventas cobradas + abonos CxC del turno"
          />
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
          <ul className="mt-1.5 grid gap-0.5 rounded-md border border-slate-200/80 bg-white/60 px-2 py-1.5 text-[10px] dark:border-slate-800/60 dark:bg-slate-900/30 sm:grid-cols-2">
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

      <div>
          <SectionTitle>Abonos CxC del turno</SectionTitle>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <MetricRow
              label="Total abonos"
              value={formatMoney(metrics.abonosCobrosTotal)}
              hint="Sumado al total cobrado del día"
            />
            <MetricRow
              label="Efectivo de abonos"
              value={formatMoney(totalAbonosEfectivoSesion(abonosCobros))}
              hint="Incluido en el efectivo esperado"
            />
          </div>
          {abonosCobros.length > 0 ? (
            <ul className="mt-1.5 max-h-[min(40dvh,18rem)] space-y-1 overflow-y-auto overscroll-contain rounded-md border border-violet-500/30 bg-violet-500/[0.06] px-2 py-1.5 text-[10px] dark:border-violet-500/25 dark:bg-violet-950/30">
              {[...abonosCobros]
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((a) => (
                  <li
                    key={a.id}
                    className="border-b border-violet-800/10 pb-1 last:border-0 last:pb-0 dark:border-violet-400/10"
                  >
                    <p className="font-semibold uppercase leading-snug text-violet-950 dark:text-violet-50">
                      {a.clienteNombre?.trim() || 'Cliente'} abonó{' '}
                      <span className="tabular-nums">+{formatMoney(a.monto)}</span> en{' '}
                      {labelFormaPagoCaja(a.formaPago)}
                    </p>
                    <p className="mt-0.5 text-violet-900/75 dark:text-violet-200/75">
                      {formatInAppTimezone(a.createdAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      {' · '}
                      Registrado por {a.usuarioNombre}
                    </p>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-1.5 rounded-md border border-slate-200/80 bg-white/60 px-2 py-1.5 text-[10px] text-slate-500 dark:border-slate-800/60 dark:bg-slate-900/30 dark:text-slate-400">
              Sin abonos registrados en este turno. Si el abono se cobró en otro turno del mismo día, selecciónelo en la lista.
            </p>
          )}
        </div>

        </div>

        <div className="space-y-3">
      <div>
        <SectionTitle>Arqueo de efectivo</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-2">
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
                    <li key={r.id} className="border-b border-sky-800/10 pb-1 last:border-0 dark:border-sky-400/10">
                      <div>
                        <span className="font-semibold tabular-nums">+{formatMoney(r.monto)}</span>
                        <span className="text-sky-900/80 dark:text-sky-200/80">
                          {' '}
                          · {formatInAppTimezone(r.createdAt, { timeStyle: 'short' })} · {r.usuarioNombre}
                        </span>
                      </div>
                      {r.notas?.trim() ? (
                        <p className="mt-0.5 font-medium text-sky-950 dark:text-sky-50">{r.notas.trim()}</p>
                      ) : null}
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
                    <li key={r.id} className="border-b border-amber-800/10 pb-1 last:border-0 dark:border-amber-400/10">
                      <div>
                        <span className="font-semibold tabular-nums">−{formatMoney(r.monto)}</span>
                        <span>
                          {' '}
                          · {formatInAppTimezone(r.createdAt, { timeStyle: 'short' })} · {r.usuarioNombre}
                        </span>
                      </div>
                      {r.notas?.trim() ? (
                        <p className="mt-0.5 font-medium text-amber-950 dark:text-amber-50">{r.notas.trim()}</p>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <SectionTitle>Cierres de terminal</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-3">
          <MetricRow label="Tarjetas POS" value={formatMoney(tarjetasEsperadasShow)} />
          <MetricRow
            label="Total cortes"
            value={conteoTarjetasShow != null ? formatMoney(conteoTarjetasShow) : '—'}
          />
          <MetricRow
            label="Diferencia"
            value={diferenciaTarjetasShow != null ? formatMoney(diferenciaTarjetasShow) : '—'}
            valueClassName={
              diferenciaTarjetasShow != null
                ? diferenciaTarjetasShow > 0.005
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : diferenciaTarjetasShow < -0.005
                    ? 'text-red-600 dark:text-red-400'
                    : undefined
                : undefined
            }
            hint="Corte − POS"
          />
        </div>
        {cierresTerminal.length > 0 ? (
          <ul className="mt-1.5 space-y-1 rounded-md border border-cyan-500/30 bg-cyan-500/[0.06] px-2 py-1.5 text-[10px] dark:border-cyan-500/25 dark:bg-cyan-950/30">
            {[...cierresTerminal]
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-cyan-800/10 pb-1 last:border-0 last:pb-0 dark:border-cyan-400/10"
                >
                  <span>
                    <span className="font-mono font-semibold tracking-wider text-cyan-950 dark:text-cyan-50">
                      Folio {c.folio}
                    </span>
                    <span className="text-cyan-900/80 dark:text-cyan-200/80">
                      {' '}
                      · {formatInAppTimezone(c.createdAt, { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                      {c.usuarioNombre}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-cyan-950 dark:text-cyan-50">
                    {formatMoney(c.total)}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-500">
            Sin cierres de terminal registrados en este turno.
          </p>
        )}
        <div className="mt-2 space-y-1.5 rounded-md border border-cyan-500/35 bg-white/70 p-2 dark:border-cyan-500/25 dark:bg-slate-900/40">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-900 dark:text-cyan-300">
            Agregar cierre de terminal
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`term-total-${sesion.id}`} className="text-[10px]">
                Total del corte
              </Label>
              <Input
                id={`term-total-${sesion.id}`}
                type="text"
                inputMode="decimal"
                value={terminalTotalInput}
                onChange={(e) => setTerminalTotalInput(e.target.value)}
                placeholder="0.00"
                className="h-8 border-cyan-600/25 text-xs dark:border-cyan-500/30 dark:bg-slate-800"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`term-folio-${sesion.id}`} className="text-[10px]">
                Folio (5 dígitos)
              </Label>
              <Input
                id={`term-folio-${sesion.id}`}
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={terminalFolioInput}
                onChange={(e) => setTerminalFolioInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="00000"
                className="h-8 border-cyan-600/25 font-mono tracking-widest text-xs dark:border-cyan-500/30 dark:bg-slate-800"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={terminalBusy}
            className="h-8 text-xs"
            onClick={() => void handleAddCierreTerminal()}
          >
            {terminalBusy ? 'Guardando…' : 'Registrar cierre'}
          </Button>
        </div>
      </div>

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
  const [abonosDetalle, setAbonosDetalle] = useState<CajaAbonoCobro[]>([]);
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
      setAbonosDetalle([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const ventana = {
          from: startOfDayFromDateKey(getMexicoDateKey(selected.openedAt)),
          to: selected.closedAt ?? new Date(),
        };
        const [ventasSesion, ventasPool, abonosHistorial] = await Promise.all([
          fetchSalesByCajaSesion(sucursalId, selectedId),
          fetchSalesPoolForCajaSesion(sucursalId, selectedId),
          listAbonosHistorialByCajaSesionFirestore(sucursalId, selectedId, ventana, {
            knownSesionIds: sesiones.map((s) => s.id),
            emptyAbonosSesionIds: sesiones
              .filter((s) => !(s.abonosCobros && s.abonosCobros.length > 0))
              .map((s) => s.id),
            recoverTaggedOnEmptySesion: !(selected.abonosCobros && selected.abonosCobros.length > 0),
          }).catch((histErr) => {
            console.error('Abonos historial (respaldo corte):', histErr);
            return [] as CajaAbonoCobro[];
          }),
        ]);
        if (cancelled) return;
        const abonos = resolveAbonosCobrosSesion(selected, ventasPool, abonosHistorial);
        setVentasDetalle(ventasSesion);
        setAbonosDetalle(abonos);
        setMetrics(computeSesionCierreMetrics(selected, ventasSesion, ventasPool, abonosHistorial));
      } catch {
        if (!cancelled) {
          setMetrics(null);
          setVentasDetalle([]);
          setAbonosDetalle([]);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sucursalId, selectedId, selected, sesiones]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        useDialogDescription
        overlayClassName={CAJA_CIERRE_DIALOG_OVERLAY_Z}
        className={cn(
          CAJA_CIERRE_DIALOG_CONTENT_Z,
          'flex !max-w-[min(calc(100vw-1rem),72rem)] max-h-[min(92dvh,calc(100dvh-1rem))] w-[min(calc(100vw-1rem),72rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 dark:border-slate-800 dark:bg-slate-900 sm:!max-w-[min(calc(100vw-2rem),80rem)] sm:w-[min(calc(100vw-2rem),80rem)]'
        )}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200/80 px-4 py-2 dark:border-slate-800/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-2.5">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <CajaCierreReportesIcon />
              Reportes de cierre de caja
            </DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Historial de turnos: apertura, cierre, ventas por medio de pago, abonos CxC, cierres de terminal y arqueo.
              {sucursalLabel ? ` Tienda: ${sucursalLabel}.` : null}
            </DialogDescription>
          </div>
        </DialogHeader>

        {!sucursalId ? (
          <p className="px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
            Elija una sucursal en el selector del encabezado para consultar cierres.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:items-stretch">
            <div className="flex max-h-[28dvh] min-h-0 shrink-0 flex-col border-b border-slate-200/80 dark:border-slate-800/60 md:max-h-none md:h-auto md:w-48 md:border-b-0 md:border-r lg:w-52 xl:w-56">
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

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2.5 sm:p-4">
              {!selected ? (
                <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                  Seleccione un turno de la lista.
                </p>
              ) : detailLoading && !metrics ? (
                <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Calculando resumen…
                </div>
              ) : metrics ? (
                <SesionDetallePanel
                  sesion={selected}
                  metrics={metrics}
                  ventas={ventasDetalle}
                  abonosCobros={abonosDetalle}
                  sucursalId={sucursalId}
                  sucursalLabel={sucursalLabel}
                  onSesionUpdated={() => void loadList()}
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
  /**
   * Se llama al tocar el botón, antes de abrir el diálogo.
   * Útil para cerrar el menú hamburguesa (Sheet) y evitar que el dismiss del Sheet
   * cancele el Dialog en el mismo gesto.
   */
  onBeforeOpen?: () => void;
  /**
   * ms de espera tras `onBeforeOpen` antes de abrir el Dialog (p. ej. 280 en móvil
   * para que termine de cerrarse el Sheet).
   */
  openDelayMs?: number;
  /** @deprecated Preferir onBeforeOpen + openDelayMs */
  onDialogOpenChange?: (open: boolean) => void;
};

/** Botón del header (Panel): icono $ + reloj, abre historial de cierres. */
export function CajaCierreReportesHeaderButton({
  sucursalId,
  sucursalLabel,
  className,
  onBeforeOpen,
  openDelayMs = 0,
  onDialogOpenChange,
}: CajaCierreReportesHeaderButtonProps) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    };
  }, []);

  const handleDialogOpenChange = (next: boolean) => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    setOpen(next);
    onDialogOpenChange?.(next);
  };

  const handleOpenClick = () => {
    onBeforeOpen?.();
    // Compat: el Header móvil cerraba el Sheet en onDialogOpenChange(true); eso hace
    // que Radix trate el Dialog como "dismiss" en el mismo gesto. Mejor: cerrar Sheet
    // en onBeforeOpen y abrir el Dialog después del delay.
    if (openDelayMs > 0) {
      if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setOpen(true);
        onDialogOpenChange?.(true);
      }, openDelayMs);
      return;
    }
    handleDialogOpenChange(true);
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
        onClick={handleOpenClick}
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
