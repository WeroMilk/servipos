import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Banknote, Lock, PowerOff, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores';
import { useAppStore } from '@/stores';
import type { CajaSesionHookValue } from '@/hooks/useCajaSesion';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { printThermalCajaCierre } from '@/lib/printTicket';
import {
  computeCajaEfectivoEsperado,
  filterVentasCompletadasSesion,
  lineasMediosPagoSesion,
  resumenBrutoSesion,
  resumenGruposMedioPagoCierre,
} from '@/lib/cajaResumen';
import { fetchSalesByCajaSesion } from '@/lib/firestore/salesFirestore';
import type { Sale } from '@/types';

type CajaPosToolbarProps = {
  sales: Sale[];
  canUse: boolean;
  sucursalId: string | null | undefined;
  caja: CajaSesionHookValue;
};

export type CajaPosToolbarHandle = {
  openAbrirCajaDialog: () => void;
  openCerrarCajaDialog: () => void;
};

export const CajaPosToolbar = forwardRef<CajaPosToolbarHandle, CajaPosToolbarProps>(
  function CajaPosToolbar({ sales, canUse, sucursalId: effectiveSucursalId, caja }, ref) {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const { activa, loading, isCloud, openCaja, closeCaja } = caja;

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [fondoInput, setFondoInput] = useState('0');
  const [conteoInput, setConteoInput] = useState('');
  const [notasCierre, setNotasCierre] = useState('');
  const [busy, setBusy] = useState(false);

  const ventasSesion = useMemo(
    () => (activa ? sales.filter((s) => s.cajaSesionId === activa.id) : []),
    [sales, activa]
  );

  const previewCierre = useMemo(() => {
    if (!activa) return null;
    const completadas = filterVentasCompletadasSesion(ventasSesion);
    const { esperadoEnCaja, efectivoCobrado, cambioEntregado } = computeCajaEfectivoEsperado(
      activa.fondoInicial,
      completadas
    );
    const { tickets, total } = resumenBrutoSesion(ventasSesion);
    return { esperadoEnCaja, efectivoCobrado, cambioEntregado, tickets, total };
  }, [activa, ventasSesion]);

  const previewRef = useRef(previewCierre);
  previewRef.current = previewCierre;

  const lineasPagoPreview = useMemo(() => lineasMediosPagoSesion(ventasSesion), [ventasSesion]);
  const gruposPagoPreview = useMemo(() => resumenGruposMedioPagoCierre(ventasSesion), [ventasSesion]);

  useImperativeHandle(
    ref,
    () => ({
      openAbrirCajaDialog: () => setOpenDialog(true),
      openCerrarCajaDialog: () => {
        if (!activa) return;
        const p = previewRef.current;
        setConteoInput(p ? String(p.esperadoEnCaja) : '');
        setCloseDialog(true);
      },
    }),
    [activa]
  );

  const userId = user?.id ?? 'system';
  const userNombre =
    user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || 'Usuario';

  const handleOpen = async () => {
    const fondo = parseFloat(fondoInput.replace(',', '.')) || 0;
    if (fondo < 0) {
      addToast({ type: 'error', message: 'El fondo inicial no puede ser negativo' });
      return;
    }
    setBusy(true);
    try {
      await openCaja({ fondoInicial: fondo, openedByUserId: userId, openedByNombre: userNombre });
      addToast({ type: 'success', message: 'Caja abierta. Ya puede registrar ventas.' });
      setOpenDialog(false);
      setFondoInput('0');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo abrir la caja',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!activa) return;
    const declarado = parseFloat(conteoInput.replace(',', '.'));
    if (!Number.isFinite(declarado) || declarado < 0) {
      addToast({ type: 'error', message: 'Ingrese el efectivo contado en caja' });
      return;
    }
    setBusy(true);
    try {
      let ventasPrint = ventasSesion;
      if (isCloud && effectiveSucursalId) {
        await closeCaja({
          sesionId: activa.id,
          conteoDeclarado: declarado,
          notasCierre: notasCierre.trim() || undefined,
          closedByUserId: userId,
          closedByNombre: userNombre,
        });
        ventasPrint = await fetchSalesByCajaSesion(effectiveSucursalId, activa.id);
      } else {
        await closeCaja({
          sesionId: activa.id,
          conteoDeclarado: declarado,
          notasCierre: notasCierre.trim() || undefined,
          closedByUserId: userId,
          closedByNombre: userNombre,
        });
      }

      const completadas = filterVentasCompletadasSesion(ventasPrint);
      const { esperadoEnCaja } = computeCajaEfectivoEsperado(activa.fondoInicial, completadas);
      const { tickets, total } = resumenBrutoSesion(ventasPrint);
      const diferencia = Math.round((declarado - esperadoEnCaja) * 100) / 100;

      printThermalCajaCierre({
        fechaLabel: formatInAppTimezone(new Date(), { dateStyle: 'full', timeStyle: 'short' }),
        sucursalId: effectiveSucursalId ?? undefined,
        ventas: ventasPrint,
        fondoInicial: activa.fondoInicial,
        conteoDeclarado: declarado,
        efectivoEsperado: esperadoEnCaja,
        diferencia,
        ticketsCompletados: tickets,
        totalVentasBruto: total,
        abiertaPor: activa.openedByNombre,
        cerradaPor: userNombre,
        aperturaLabel: formatInAppTimezone(activa.openedAt, { dateStyle: 'short', timeStyle: 'short' }),
        cierreLabel: formatInAppTimezone(new Date(), { dateStyle: 'short', timeStyle: 'short' }),
      });

      addToast({ type: 'success', message: 'Caja cerrada. Se abrió el comprobante para imprimir.' });
      setCloseDialog(false);
      setConteoInput('');
      setNotasCierre('');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cerrar la caja',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!canUse) return null;

  return (
    <>
      <div
        className={cn(
          'flex shrink-0 flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4',
          activa
            ? 'border-emerald-500/40 bg-emerald-500/10 dark:border-emerald-500/35'
            : isCloud
              ? 'border-amber-500/45 bg-amber-500/10 dark:border-amber-500/35'
              : 'border-slate-300/80 bg-slate-200/50 dark:border-slate-700 dark:bg-slate-800/40'
        )}
      >
        <div className="flex min-w-0 items-start gap-2 sm:items-center">
          {activa ? (
            <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 sm:mt-0" />
          ) : (
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400 sm:mt-0" />
          )}
          <div className="min-w-0 text-xs leading-snug sm:text-sm">
            {loading ? (
              <p className="text-slate-600 dark:text-slate-400">Sincronizando estado de caja…</p>
            ) : activa ? (
              <p className="text-emerald-950 dark:text-emerald-100">
                <span className="font-semibold">Caja abierta</span> · Fondo{' '}
                {formatMoney(activa.fondoInicial)} · {activa.openedByNombre} ·{' '}
                {formatInAppTimezone(activa.openedAt, { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            ) : isCloud ? (
              <p className="text-amber-950 dark:text-amber-100">
                <span className="font-semibold">Caja cerrada</span>. Abra caja para registrar cobros y ventas en
                esta tienda.
              </p>
            ) : (
              <p className="text-slate-700 dark:text-slate-300">
                <span className="font-semibold">Modo local</span>. Puede abrir caja para asociar ventas al arqueo
                (opcional).
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!activa ? (
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={loading || busy}
              onClick={() => setOpenDialog(true)}
            >
              <Banknote className="mr-1.5 h-4 w-4" />
              Abrir caja
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="border-red-500/35 text-red-800 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-200 dark:hover:bg-red-500/15"
              disabled={busy}
              onClick={() => {
                setConteoInput(previewCierre ? String(previewCierre.esperadoEnCaja) : '');
                setCloseDialog(true);
              }}
            >
              <PowerOff className="mr-1.5 h-4 w-4" />
              Cerrar caja
            </Button>
          )}
        </div>
      </div>

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Registre el efectivo inicial en cajón (fondo). Quedará asociado a sus ventas hasta el cierre.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Fondo inicial (efectivo)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={fondoInput}
                onChange={(e) => setFondoInput(e.target.value)}
                className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy} onClick={() => void handleOpen()}>
              {busy ? 'Abriendo…' : 'Confirmar apertura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Compare el efectivo contado con el esperado según el sistema. Al confirmar se genera un comprobante
              para impresora térmica.
            </DialogDescription>
          </DialogHeader>
          {activa && previewCierre ? (
            <div className="space-y-3 py-2 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-200/60 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="font-medium text-slate-800 dark:text-slate-200">Resumen de la sesión</p>
                <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Fondo inicial: {formatMoney(activa.fondoInicial)}</li>
                  <li>Efectivo cobrado (pagos 01): {formatMoney(previewCierre.efectivoCobrado)}</li>
                  <li>Cambio entregado: {formatMoney(previewCierre.cambioEntregado)}</li>
                  <li className="font-semibold text-slate-800 dark:text-slate-200">
                    Esperado en caja: {formatMoney(previewCierre.esperadoEnCaja)}
                  </li>
                  <li>Tickets completados: {previewCierre.tickets}</li>
                  <li>Total ventas (completadas): {formatMoney(previewCierre.total)}</li>
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-200/40 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <p className="font-medium text-slate-800 dark:text-slate-200">Ventas por medio de pago</p>
                <ul className="mt-2 grid gap-1.5 text-slate-700 dark:text-slate-300 sm:grid-cols-3">
                  <li className="rounded-md bg-slate-100/90 px-2 py-1.5 dark:bg-slate-900/50">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Efectivo
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(gruposPagoPreview.efectivoCobros)}</span>
                  </li>
                  <li className="rounded-md bg-slate-100/90 px-2 py-1.5 dark:bg-slate-900/50">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Tarjetas
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(gruposPagoPreview.tarjetas)}</span>
                  </li>
                  <li className="rounded-md bg-slate-100/90 px-2 py-1.5 dark:bg-slate-900/50">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Otros medios
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(gruposPagoPreview.otros)}</span>
                  </li>
                </ul>
                {lineasPagoPreview.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-400">
                    {lineasPagoPreview.map((row) => (
                      <li key={row.clave} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{row.label}</span>
                        <span className="shrink-0 tabular-nums font-medium text-slate-800 dark:text-slate-200">
                          {formatMoney(row.monto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">Sin cobros en esta sesión aún.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Conteo físico de efectivo</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={conteoInput}
                  onChange={(e) => setConteoInput(e.target.value)}
                  placeholder={String(previewCierre.esperadoEnCaja)}
                  className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="space-y-2">
                <Label>Notas (opcional)</Label>
                <Input
                  value={notasCierre}
                  onChange={(e) => setNotasCierre(e.target.value)}
                  placeholder="Observaciones del arqueo"
                  className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setCloseDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleClose()}>
              {busy ? 'Cerrando…' : 'Confirmar cierre e imprimir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  }
);
