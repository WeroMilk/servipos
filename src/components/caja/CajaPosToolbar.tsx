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
import { printThermalCajaCierre, printThermalDailySalesReport } from '@/lib/printTicket';
import {
  fetchSalesByCajaSesion,
} from '@/lib/firestore/salesFirestore';
import { registrarRetiroEfectivoFirestore } from '@/lib/firestore/cajaFirestore';
import { cancelSale, completePendingSale } from '@/db/database';
import {
  computeCajaEfectivoEsperado,
  efectivoEsperadoMenosRetiros,
  filterVentasCompletadasSesion,
  lineasMediosPagoSesion,
  resumenBrutoSesion,
  resumenGruposMedioPagoCierre,
} from '@/lib/cajaResumen';
import type { Sale } from '@/types';
import { useCajaLocalStore } from '@/stores/cajaLocalStore';
import { isRemotePermissionDenied, SUPABASE_PERMISSION_HINT } from '@/lib/remotePermissionError';

function cajaFirestoreUserMessage(e: unknown): string {
  if (isRemotePermissionDenied(e)) {
    return `Sin permiso al usar caja en la nube. ${SUPABASE_PERMISSION_HINT}`;
  }
  if (e instanceof Error) return e.message;
  return 'No se pudo completar la operación de caja';
}

type CajaPosToolbarProps = {
  sales: Sale[];
  canUse: boolean;
  sucursalId: string | null | undefined;
  caja: CajaSesionHookValue;
  /** Si es false, solo se montan los diálogos (control desde el header). */
  showStatusBar?: boolean;
};

export type CajaPosToolbarHandle = {
  openAbrirCajaDialog: () => void;
  openCerrarCajaDialog: () => void;
  openArqueoDialog: () => void;
  openRetiroEfectivoDialog: () => void;
};

export const CajaPosToolbar = forwardRef<CajaPosToolbarHandle, CajaPosToolbarProps>(
  function CajaPosToolbar(
    { sales, canUse, sucursalId: effectiveSucursalId, caja, showStatusBar = true },
    ref
  ) {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const { activa, loading, isCloud, openCaja, closeCaja } = caja;

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [arqueoDialog, setArqueoDialog] = useState(false);
  const [retiroDialog, setRetiroDialog] = useState(false);
  const [fondoInput, setFondoInput] = useState('0');
  const [conteoInput, setConteoInput] = useState('');
  const [notasCierre, setNotasCierre] = useState('');
  const [retiroMontoInput, setRetiroMontoInput] = useState('');
  const [retiroNotas, setRetiroNotas] = useState('');
  const [busy, setBusy] = useState(false);

  const ventasSesion = useMemo(
    () => (activa ? sales.filter((s) => s.cajaSesionId === activa.id) : []),
    [sales, activa]
  );

  const previewCierre = useMemo(() => {
    if (!activa) return null;
    const completadas = filterVentasCompletadasSesion(ventasSesion);
    const { esperadoEnCaja: esperadoBruto, efectivoCobrado, cambioEntregado } = computeCajaEfectivoEsperado(
      activa.fondoInicial,
      completadas
    );
    const retirosTotal = activa.retirosEfectivoTotal ?? 0;
    const esperadoEnCaja = efectivoEsperadoMenosRetiros(esperadoBruto, retirosTotal);
    const { tickets, total } = resumenBrutoSesion(ventasSesion);
    return {
      esperadoEnCaja,
      esperadoBruto,
      retirosTotal,
      efectivoCobrado,
      cambioEntregado,
      tickets,
      total,
    };
  }, [activa, ventasSesion]);

  const previewRef = useRef(previewCierre);
  previewRef.current = previewCierre;

  const lineasPagoPreview = useMemo(() => lineasMediosPagoSesion(ventasSesion), [ventasSesion]);
  const gruposPagoPreview = useMemo(() => resumenGruposMedioPagoCierre(ventasSesion), [ventasSesion]);
  const lineasTarjetaPreview = useMemo(
    () => lineasPagoPreview.filter((r) => r.clave === '04' || r.clave === '28' || r.clave === '29'),
    [lineasPagoPreview]
  );

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
      openArqueoDialog: () => {
        if (!activa) return;
        setArqueoDialog(true);
      },
      openRetiroEfectivoDialog: () => {
        if (!activa) return;
        setRetiroMontoInput('');
        setRetiroNotas('');
        setRetiroDialog(true);
      },
    }),
    [activa]
  );

  const userId = user?.id ?? 'system';
  const userNombre =
    user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || 'Usuario';

  const retirosOrdenados =
    activa?.retirosEfectivo?.length ?
      [...activa.retirosEfectivo].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    : [];

  const conciliacionDestacada =
    activa && previewCierre ? (
      <div className="space-y-3 lg:space-y-2">
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-2.5">
          <div className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/[0.12] p-4 dark:border-emerald-500/40 dark:bg-emerald-950/40 lg:rounded-lg lg:p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300 lg:text-[10px]">
              Efectivo que debe haber en caja
            </p>
            <p className="mt-1 text-xs leading-snug text-emerald-900/90 dark:text-emerald-200/85 lg:mt-0.5 lg:text-[11px] lg:leading-tight">
              Fondo inicial más cobros en efectivo, menos cambio al cliente
              {previewCierre.retirosTotal > 0.005 ? ', menos retiros a bóveda/banco' : ''}. El importe grande ya
              refleja esos retiros.
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-emerald-950 dark:text-emerald-50 lg:mt-1 lg:text-xl">
              {formatMoney(previewCierre.esperadoEnCaja)}
            </p>
            <p className="mt-2 text-xs tabular-nums text-emerald-900/80 dark:text-emerald-300/90 lg:mt-1 lg:text-[10px] lg:leading-tight">
              {formatMoney(activa.fondoInicial)} (fondo) + {formatMoney(previewCierre.efectivoCobrado)} (cobros
              efectivo) − {formatMoney(previewCierre.cambioEntregado)} (cambio)
              {previewCierre.retirosTotal > 0.005 ? (
                <>
                  {' '}
                  − {formatMoney(previewCierre.retirosTotal)} (retiros)
                </>
              ) : null}
            </p>
          </div>
          <div className="rounded-xl border-2 border-cyan-500/50 bg-cyan-500/[0.12] p-4 dark:border-cyan-500/40 dark:bg-cyan-950/40 lg:rounded-lg lg:p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-900 dark:text-cyan-300 lg:text-[10px]">
              Tarjetas — total para cuadrar
            </p>
            <p className="mt-1 text-xs leading-snug text-cyan-900/90 dark:text-cyan-200/85 lg:mt-0.5 lg:text-[11px] lg:leading-tight">
              Total de cobros con tarjeta en esta sesión en el POS. Cuadre este importe con la suma de comprobantes
              (vouchers) o con el corte que reporte su terminal bancaria.
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-cyan-950 dark:text-cyan-50 lg:mt-1 lg:text-xl">
              {formatMoney(gruposPagoPreview.tarjetas)}
            </p>
            {lineasTarjetaPreview.length > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-cyan-800/25 pt-2 text-xs text-cyan-950/95 dark:border-cyan-400/25 dark:text-cyan-100/90 lg:mt-1.5 lg:pt-1.5 lg:text-[11px]">
                {lineasTarjetaPreview.map((row) => (
                  <li key={row.clave} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{row.label}</span>
                    <span className="shrink-0 tabular-nums font-medium">{formatMoney(row.monto)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-cyan-900/75 dark:text-cyan-300/75 lg:mt-1 lg:text-[11px]">
                Sin cobros con tarjeta en esta sesión.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-amber-500/35 bg-amber-500/[0.08] p-3 dark:border-amber-500/30 dark:bg-amber-950/25 lg:p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-950 dark:text-amber-200 lg:text-[10px]">
            Retiros de efectivo (esta sesión)
          </p>
          {retirosOrdenados.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs text-amber-950/95 dark:text-amber-100/90 lg:mt-1.5 lg:space-y-1.5 lg:text-[11px]">
              {retirosOrdenados.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-0.5 border-b border-amber-800/15 pb-2 last:border-b-0 last:pb-0 dark:border-amber-400/15"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <span className="tabular-nums font-semibold text-amber-950 dark:text-amber-50">
                      −{formatMoney(r.monto)}
                    </span>
                    <span className="text-amber-900/85 dark:text-amber-200/80">
                      {formatInAppTimezone(r.createdAt, { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                      {r.usuarioNombre}
                    </span>
                  </div>
                  {r.notas?.trim() ? (
                    <span className="text-amber-900/75 dark:text-amber-300/80">{r.notas.trim()}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-300/75 lg:mt-1 lg:text-[11px]">
              No hay retiros registrados. El efectivo esperado coincide con fondo + efectivo neto de ventas.
            </p>
          )}
        </div>
      </div>
    ) : null;

  const handleOpen = async () => {
    const fondo = parseFloat(fondoInput.replace(',', '.')) || 0;
    if (fondo < 0) {
      addToast({ type: 'error', message: 'El fondo inicial no puede ser negativo', logToAppEvents: true });
      return;
    }
    setBusy(true);
    try {
      await openCaja({ fondoInicial: fondo, openedByUserId: userId, openedByNombre: userNombre });
      addToast({
        type: 'success',
        message: 'Caja abierta. Ya puede registrar ventas.',
        logToAppEvents: true,
      });
      setOpenDialog(false);
      setFondoInput('0');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: cajaFirestoreUserMessage(e),
        logToAppEvents: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRegistrarRetiro = async () => {
    if (!activa || !previewCierre) return;
    const monto = parseFloat(retiroMontoInput.replace(',', '.'));
    if (!Number.isFinite(monto) || monto <= 0) {
      addToast({ type: 'error', message: 'Ingrese un monto válido mayor a cero' });
      return;
    }
    const disponible = previewCierre.esperadoEnCaja;
    const mRounded = Math.round(monto * 100) / 100;
    if (mRounded > disponible + 0.005) {
      addToast({
        type: 'error',
        message: `No puede retirar más del efectivo disponible en caja (${formatMoney(disponible)}).`,
        logToAppEvents: true,
      });
      return;
    }
    setBusy(true);
    try {
      if (isCloud && effectiveSucursalId) {
        await registrarRetiroEfectivoFirestore(effectiveSucursalId, activa.id, {
          monto: mRounded,
          notas: retiroNotas.trim() || undefined,
          usuarioId: userId,
          usuarioNombre: userNombre,
        });
      } else {
        useCajaLocalStore.getState().addRetiroEfectivo({
          monto: mRounded,
          notas: retiroNotas.trim() || undefined,
          usuarioId: userId,
          usuarioNombre: userNombre,
        });
      }
      addToast({
        type: 'success',
        message: `Retiro registrado: ${formatMoney(mRounded)}`,
        logToAppEvents: true,
      });
      setRetiroDialog(false);
      setRetiroMontoInput('');
      setRetiroNotas('');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: cajaFirestoreUserMessage(e),
        logToAppEvents: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!activa) return;
    const declarado = parseFloat(conteoInput.replace(',', '.'));
    if (!Number.isFinite(declarado) || declarado < 0) {
      addToast({ type: 'error', message: 'Ingrese el efectivo contado en caja', logToAppEvents: true });
      return;
    }
    setBusy(true);
    try {
      const pendientesSesion = ventasSesion.filter((s) => s.estado === 'pendiente');
      if (pendientesSesion.length > 0) {
        const dbOpt = effectiveSucursalId ? { sucursalId: effectiveSucursalId } : undefined;
        let pasadasCxc = 0;
        let canceladasSinCliente = 0;
        for (const vs of pendientesSesion) {
          const registrado =
            Boolean(vs.clienteId) &&
            vs.clienteId !== 'mostrador' &&
            !vs.cliente?.isMostrador;
          if (registrado) {
            await completePendingSale(
              vs.id,
              {
                formaPago: 'PPC',
                metodoPago: 'PPD',
                pagos: [],
                cambio: 0,
                usuarioNombreCierre: userNombre,
                cajaSesionId: activa.id,
                clienteId: vs.clienteId!,
                cliente: vs.cliente ?? null,
              },
              dbOpt
            );
            pasadasCxc += 1;
          } else {
            await cancelSale(vs.id, {
              motivo: 'Cierre de caja: venta abierta sin cliente registrado',
              sucursalId: effectiveSucursalId ?? undefined,
              cancelacionMotivo: 'panel',
            });
            canceladasSinCliente += 1;
          }
        }
        const partes: string[] = [];
        if (pasadasCxc > 0) {
          partes.push(
            `${pasadasCxc} venta(s) abierta(s) pasada(s) a cuentas por cobrar (pendiente de pago)`
          );
        }
        if (canceladasSinCliente > 0) {
          partes.push(
            `${canceladasSinCliente} venta(s) sin cliente registrado cancelada(s); inventario restaurado`
          );
        }
        if (partes.length > 0) {
          addToast({ type: 'success', message: partes.join('. ') + '.', logToAppEvents: true });
        }
      }

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
      const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(activa.fondoInicial, completadas);
      const retirosTotal = activa.retirosEfectivoTotal ?? 0;
      const esperadoEnCaja = efectivoEsperadoMenosRetiros(esperadoBruto, retirosTotal);
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
        retirosEfectivoTotal: retirosTotal > 0.005 ? retirosTotal : undefined,
        retirosEfectivo: activa.retirosEfectivo?.length ? activa.retirosEfectivo : undefined,
        ticketKind: 'cierre',
      });

      printThermalDailySalesReport({
        fechaLabel: formatInAppTimezone(new Date(), { dateStyle: 'full', timeStyle: 'short' }),
        sucursalId: effectiveSucursalId ?? undefined,
        ventas: ventasPrint,
      });

      addToast({
        type: 'success',
        message: 'Caja cerrada. Comprobante y reporte de la sesión listos para imprimir.',
        logToAppEvents: true,
      });
      setCloseDialog(false);
      setConteoInput('');
      setNotasCierre('');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: cajaFirestoreUserMessage(e),
        logToAppEvents: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const imprimirArqueoYReporteDia = async () => {
    if (!activa || !previewCierre) return;
    const completadas = filterVentasCompletadasSesion(ventasSesion);
    const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(activa.fondoInicial, completadas);
    const retirosTotal = activa.retirosEfectivoTotal ?? 0;
    const esperadoEnCaja = efectivoEsperadoMenosRetiros(esperadoBruto, retirosTotal);
    const { tickets, total } = resumenBrutoSesion(ventasSesion);
    const ahora = new Date();
    printThermalCajaCierre({
      fechaLabel: formatInAppTimezone(ahora, { dateStyle: 'full', timeStyle: 'short' }),
      sucursalId: effectiveSucursalId ?? undefined,
      ventas: ventasSesion,
      fondoInicial: activa.fondoInicial,
      conteoDeclarado: esperadoEnCaja,
      efectivoEsperado: esperadoEnCaja,
      diferencia: 0,
      ticketsCompletados: tickets,
      totalVentasBruto: total,
      abiertaPor: activa.openedByNombre,
      cerradaPor: userNombre,
      aperturaLabel: formatInAppTimezone(activa.openedAt, { dateStyle: 'short', timeStyle: 'short' }),
      cierreLabel: formatInAppTimezone(ahora, { dateStyle: 'short', timeStyle: 'short' }),
      retirosEfectivoTotal: retirosTotal > 0.005 ? retirosTotal : undefined,
      retirosEfectivo: activa.retirosEfectivo?.length ? activa.retirosEfectivo : undefined,
      ticketKind: 'arqueo_previo',
    });
    printThermalDailySalesReport({
      fechaLabel: formatInAppTimezone(ahora, { dateStyle: 'full', timeStyle: 'short' }),
      sucursalId: effectiveSucursalId ?? undefined,
      ventas: ventasSesion,
    });
    addToast({
      type: 'success',
      message: 'Arqueo previo y reporte de la sesión listos para imprimir.',
      logToAppEvents: true,
    });
    setArqueoDialog(false);
  };

  if (!canUse) return null;

  return (
    <>
      {showStatusBar ? (
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
      ) : null}

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
              Efectivo esperado (fondo + efectivo de ventas − cambio − retiros de sesión), listado de retiros si
              los hubo, y total tarjetas para cuadrar con terminal o vouchers. Compare el conteo físico con el
              esperado. Al confirmar se imprime el comprobante.
            </DialogDescription>
          </DialogHeader>
          {activa && previewCierre ? (
            <div className="space-y-3 py-2 text-sm">
              {conciliacionDestacada}

              <div className="rounded-lg border border-slate-200 bg-slate-200/40 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Desglose por forma de pago (sesión)
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">
                  Tickets completados: {previewCierre.tickets} · Total ventas (completadas):{' '}
                  {formatMoney(previewCierre.total)}
                </p>
                {gruposPagoPreview.otros > 0 ? (
                  <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    Otros medios (transferencia, etc.): {formatMoney(gruposPagoPreview.otros)}
                  </p>
                ) : null}
                {lineasPagoPreview.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-400">
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

      <Dialog open={arqueoDialog} onOpenChange={setArqueoDialog}>
        <DialogContent
          useDialogDescription
          className="max-h-[min(88dvh,36rem)] overflow-y-auto border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md lg:max-h-none lg:max-w-[min(52rem,calc(100vw-2rem))] lg:overflow-visible lg:gap-3 lg:py-4"
        >
          <DialogHeader className="lg:gap-1">
            <DialogTitle className="lg:text-base">Arqueo previo</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400 lg:text-xs lg:leading-snug">
              Efectivo esperado (incluye descuento por retiros de la sesión), detalle de retiros y total
              tarjetas. Al imprimir se genera el arqueo de la sesión y el reporte de ventas de esta misma sesión
              (apertura a cierre de caja).
            </DialogDescription>
          </DialogHeader>
          {activa && previewCierre ? (
            <div className="space-y-3 py-2 text-sm lg:space-y-2 lg:py-0">
              {conciliacionDestacada}

              <div className="rounded-lg border border-slate-200 bg-slate-200/40 p-3 dark:border-slate-700 dark:bg-slate-800/40 lg:p-2">
                <p className="font-medium text-slate-800 dark:text-slate-200 lg:text-sm">
                  Desglose por forma de pago (sesión)
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500 lg:mt-0.5">
                  Tickets completados: {previewCierre.tickets} · Total ventas (completadas):{' '}
                  {formatMoney(previewCierre.total)}
                </p>
                {gruposPagoPreview.otros > 0 ? (
                  <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300 lg:mt-1">
                    Otros medios (transferencia, etc.): {formatMoney(gruposPagoPreview.otros)}
                  </p>
                ) : null}
                {lineasPagoPreview.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-400 lg:mt-1.5 lg:pt-1.5">
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
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 lg:mt-1">
                    Sin cobros en esta sesión aún.
                  </p>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0 lg:pt-0">
            <Button type="button" variant="outline" onClick={() => setArqueoDialog(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={() => void imprimirArqueoYReporteDia()}>
              Imprimir arqueo y reporte del día
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retiroDialog} onOpenChange={setRetiroDialog}>
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retiro de efectivo</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Registre el efectivo que sale de caja (p. ej. excedente o depósito). El sistema resta el monto del
              efectivo esperado en cajón hasta el cierre.
            </DialogDescription>
          </DialogHeader>
          {activa && previewCierre ? (
            <div className="space-y-3 py-2 text-sm">
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-950/30 dark:text-emerald-100">
                <span className="font-medium">Disponible para retirar:</span>{' '}
                <span className="tabular-nums font-semibold">{formatMoney(previewCierre.esperadoEnCaja)}</span>
              </p>
              <div className="space-y-2">
                <Label>Monto a retirar</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={retiroMontoInput}
                  onChange={(e) => setRetiroMontoInput(e.target.value)}
                  placeholder="0.00"
                  className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="space-y-2">
                <Label>Notas (opcional)</Label>
                <Input
                  value={retiroNotas}
                  onChange={(e) => setRetiroNotas(e.target.value)}
                  placeholder="Motivo o referencia"
                  className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetiroDialog(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleRegistrarRetiro()}>
              {busy ? 'Registrando…' : 'Confirmar retiro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  }
);
