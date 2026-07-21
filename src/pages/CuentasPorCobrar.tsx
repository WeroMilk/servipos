import { useMemo, useState } from 'react';
import { Wallet, Printer, History, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useClients } from '@/hooks/useClients';
import { useInvoices } from '@/hooks/useInvoices';
import { useAppStore, useAuthStore } from '@/stores';
import { FORMAS_PAGO, FORMAS_PAGO_UI, type Client, type FormaPago } from '@/types';
import { formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { printThermalClientAbonoReceipt, type ThermalClientAbonoReceiptInput } from '@/lib/printTicket';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useCajaSesion } from '@/hooks/useCajaSesion';
import { registrarAbonoCobroCajaFirestore } from '@/lib/firestore/cajaFirestore';
import {
  anularAbonoCxC,
  aplicarAbonoATicketsCliente,
  condonarCuentaPorCobrarCliente,
} from '@/db/database';
import { listaAbonosCxCMostrable } from '@/lib/clientAbonoHistorialUi';
import { stampPaymentComplementWithFacturama } from '@/hooks/useFacturama';
import { saldoInsolutoFacturaPpd, siguienteParcialidad } from '@/lib/facturama/ppdSaldo';
import type { ClientAbonoHistorialEntry, Invoice } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function saldoCliente(c: Client): number {
  const v = Number(c.saldoAdeudado);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

function labelFormaPago(clave: string): string {
  return FORMAS_PAGO.find((f) => f.clave === clave)?.descripcion ?? clave;
}

function ultimoAbonoBadgeLabel(c: Client): string | null {
  if (!c.ultimoAbonoAt || c.ultimoAbonoMonto == null) return null;
  const d = c.ultimoAbonoAt instanceof Date ? c.ultimoAbonoAt : new Date(c.ultimoAbonoAt);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const when = sameDay
    ? `hoy ${formatInAppTimezone(d, { timeStyle: 'short' })}`
    : formatInAppTimezone(d, { dateStyle: 'short', timeStyle: 'short' });
  return `Último abono: ${when}`;
}

export function CuentasPorCobrar() {
  const { clients, loading: loadingClients, registrarAbonoCuenta } = useClients();
  const { invoices } = useInvoices();
  const { addToast } = useAppStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canDeleteCxC = user?.role === 'admin' || user?.role === 'gerente';
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const caja = useCajaSesion({ sucursalId: effectiveSucursalId });
  const canTimbrar = hasPermission('facturas:timbrar') || hasPermission('facturas:crear');

  const deudores = useMemo(() => {
    const rows = clients.filter((c) => !c.isMostrador && saldoCliente(c) > 0.005);
    rows.sort((a, b) => saldoCliente(b) - saldoCliente(a));
    return rows;
  }, [clients]);

  const totalSaldoPendiente = useMemo(
    () => Math.round(deudores.reduce((s, c) => s + saldoCliente(c), 0) * 100) / 100,
    [deudores]
  );

  const [abonoCliente, setAbonoCliente] = useState<Client | null>(null);
  const [abonoMonto, setAbonoMonto] = useState('');
  const [abonoFormaPago, setAbonoFormaPago] = useState<FormaPago>('01');
  const [abonoBusy, setAbonoBusy] = useState(false);
  const [emitirComplemento, setEmitirComplemento] = useState(false);
  const [abonoFacturaId, setAbonoFacturaId] = useState<string>('');
  const [abonoFormaPagoCfdi, setAbonoFormaPagoCfdi] = useState('03');

  const [copiaClienteOpen, setCopiaClienteOpen] = useState(false);
  const [copiaClientePayload, setCopiaClientePayload] = useState<ThermalClientAbonoReceiptInput | null>(
    null
  );

  const [historialCliente, setHistorialCliente] = useState<Client | null>(null);
  const [abonoHistCancelTarget, setAbonoHistCancelTarget] = useState<{
    client: Client;
    entry: ClientAbonoHistorialEntry;
  } | null>(null);
  const [abonoHistCancelBusy, setAbonoHistCancelBusy] = useState(false);

  const [eliminarClienteTarget, setEliminarClienteTarget] = useState<Client | null>(null);
  const [eliminarClienteBusy, setEliminarClienteBusy] = useState(false);

  const ppdFacturasCliente = useMemo((): Invoice[] => {
    if (!abonoCliente) return [];
    return invoices.filter(
      (inv) =>
        inv.clienteId === abonoCliente.id &&
        inv.estado === 'timbrada' &&
        inv.metodoPago === 'PPD' &&
        inv.uuid &&
        !inv.esPrueba &&
        saldoInsolutoFacturaPpd(inv) > 0.005
    );
  }, [abonoCliente, invoices]);

  const cerrarAbono = () => {
    setAbonoCliente(null);
    setAbonoMonto('');
    setAbonoFormaPago('01');
    setEmitirComplemento(false);
    setAbonoFacturaId('');
    setAbonoFormaPagoCfdi('03');
  };

  const confirmarAbono = async () => {
    if (!abonoCliente) return;
    const norm = abonoMonto.replace(',', '.').trim();
    const m = parseFloat(norm);
    if (!Number.isFinite(m) || m <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto válido mayor a cero.' });
      return;
    }
    if (!abonoFormaPago) {
      addToast({ type: 'warning', message: 'Seleccione cómo se pagó el abono (efectivo, tarjeta, etc.).' });
      return;
    }
    if (caja.mustOpenCajaToSell && !caja.activa) {
      addToast({
        type: 'error',
        message: 'Abra la caja para registrar el abono y que cuente en el corte.',
        logToAppEvents: true,
      });
      return;
    }
    setAbonoBusy(true);
    try {
      const saldoAnterior = saldoCliente(abonoCliente);
      const cajaSesionId = caja.activa?.id;
      const cajeroNombre = user?.name?.trim() || user?.email || undefined;
      const receipt: ThermalClientAbonoReceiptInput = {
        fechaLabel: formatInAppTimezone(new Date(), { dateStyle: 'short', timeStyle: 'short' }),
        sucursalId: effectiveSucursalId ?? undefined,
        cajeroNombre,
        clienteNombre: abonoCliente.nombre,
        montoAbono: m,
        formaPago: abonoFormaPago,
        saldoAnterior,
        saldoNuevo: Math.max(0, Math.round((saldoAnterior - m) * 100) / 100),
      };
      await registrarAbonoCuenta(abonoCliente.id, m, {
        usuarioNombre: cajeroNombre,
        formaPago: abonoFormaPago,
        cajaSesionId,
      });

      let ticketsAplicados = 0;
      try {
        const { aplicadoATickets, tickets } = await aplicarAbonoATicketsCliente(abonoCliente.id, m, {
          formaPago: abonoFormaPago,
          sucursalId: effectiveSucursalId ?? undefined,
          cajaSesionId,
        });
        ticketsAplicados = tickets.length;
        void aplicadoATickets;
      } catch (ticketErr) {
        addToast({
          type: 'warning',
          message:
            ticketErr instanceof Error
              ? `Abono guardado, pero no se aplicó a tickets: ${ticketErr.message}`
              : 'Abono guardado; no se pudo aplicar a las ventas',
          logToAppEvents: true,
        });
      }

      if (effectiveSucursalId && cajaSesionId) {
        const payloadCaja = {
          monto: m,
          formaPago: abonoFormaPago,
          clienteId: abonoCliente.id,
          clienteNombre: abonoCliente.nombre,
          usuarioId: user?.id ?? 'system',
          usuarioNombre: cajeroNombre || 'Usuario',
        };
        try {
          try {
            await registrarAbonoCobroCajaFirestore(effectiveSucursalId, cajaSesionId, payloadCaja);
          } catch {
            // reintento registro abono caja (RPC a veces falla a la primera)
            await registrarAbonoCobroCajaFirestore(effectiveSucursalId, cajaSesionId, payloadCaja);
          }
        } catch (cajaErr) {
          addToast({
            type: 'warning',
            message:
              cajaErr instanceof Error
                ? `Abono guardado, pero no se reflejó en caja: ${cajaErr.message}`
                : 'Abono guardado; no se pudo registrar en el corte de caja',
            logToAppEvents: true,
          });
        }
      }

      if (emitirComplemento && canTimbrar && abonoFacturaId) {
        const inv = invoices.find((x) => x.id === abonoFacturaId);
        if (inv) {
          try {
            const prev = saldoInsolutoFacturaPpd(inv);
            const amount = Math.min(m, prev);
            const { complement } = await stampPaymentComplementWithFacturama({
              invoice: inv,
              paymentDate: new Date(),
              paymentForm: abonoFormaPagoCfdi || abonoFormaPago,
              amountPaid: amount,
              previousBalance: prev,
              partialityNumber: siguienteParcialidad(inv),
            });
            addToast({
              type: 'success',
              message: `Abono + complemento CFDI (${complement.uuid.slice(0, 8)}…)`,
              logToAppEvents: true,
            });
          } catch (cfdiErr) {
            addToast({
              type: 'warning',
              message:
                cfdiErr instanceof Error
                  ? `Abono guardado, pero el complemento falló: ${cfdiErr.message}`
                  : 'Abono guardado; falló el complemento de pago',
              logToAppEvents: true,
            });
          }
        }
      } else {
        addToast({
          type: 'success',
          message:
            ticketsAplicados > 0
              ? `Abono de ${formatMoney(m)} en ${labelFormaPago(abonoFormaPago)} registrado y aplicado a ${ticketsAplicados} ticket(s).`
              : `Abono de ${formatMoney(m)} en ${labelFormaPago(abonoFormaPago)} registrado.`,
          logToAppEvents: true,
        });
      }

      printThermalClientAbonoReceipt(receipt);
      cerrarAbono();
      setCopiaClientePayload(receipt);
      setCopiaClienteOpen(true);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar el abono',
        logToAppEvents: true,
      });
    } finally {
      setAbonoBusy(false);
    }
  };


  const confirmarEliminarCliente = async () => {
    if (!eliminarClienteTarget) return;
    const cli = eliminarClienteTarget;
    setEliminarClienteBusy(true);
    try {
      const { ticketsAfectados, montoCondonado } = await condonarCuentaPorCobrarCliente(cli.id, {
        sucursalId: effectiveSucursalId ?? undefined,
        usuarioNombre: user?.name,
      });
      addToast({
        type: 'success',
        message: `Cuenta por cobrar de ${cli.nombre} eliminada: ${formatMoney(montoCondonado)} en ${ticketsAfectados} ticket(s).`,
        logToAppEvents: true,
      });
      setEliminarClienteTarget(null);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar la cuenta por cobrar',
        logToAppEvents: true,
      });
    } finally {
      setEliminarClienteBusy(false);
    }
  };

  return (
    <PageShell title="Cuentas por cobrar">
      <div className="flex min-h-0 min-w-0 w-full flex-1 basis-0 flex-col gap-3 overflow-hidden max-md:flex-none max-md:basis-auto max-md:min-h-min max-md:overflow-visible">
        <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5 dark:border-slate-800/50 dark:bg-slate-900/50 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Wallet className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-xs text-slate-600 dark:text-slate-400">Total por cobrar</p>
                <p className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                  {formatMoney(totalSaldoPendiente)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">
              {deudores.length} cliente{deudores.length === 1 ? '' : 's'} con saldo pendiente
            </p>
          </div>
          <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
            Fiado: en el POS elija un cliente registrado y cobre con{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">Pendiente de pago</span> o{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">Parcialidades (PPD)</span>; el saldo
            aparece aquí. Los abonos globales del cliente se registran con «Abonar» (ticket térmico).
          </p>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden max-md:flex-none max-md:basis-auto max-md:overflow-visible">
          <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800/50 max-md:flex-none max-md:basis-auto max-md:overflow-visible">
            <div className="shrink-0 border-b border-slate-200/80 px-3 py-2 dark:border-slate-800/50 sm:px-4">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Saldo por cliente y abonos
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-500">
                Historial de abonos con fecha e importe; también puede cobrar por ticket desde «Abrir venta» en el POS.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 max-md:flex-none max-md:overflow-x-auto max-md:overflow-y-visible">
            {loadingClients ? (
              <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">Cargando…</p>
            ) : deudores.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">
                Ningún cliente con saldo pendiente.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-700 dark:text-slate-300">Cliente</TableHead>
                    <TableHead className="text-right text-slate-700 dark:text-slate-300">Saldo</TableHead>
                    <TableHead className="w-[1%] text-slate-700 dark:text-slate-300">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deudores.map((c) => (
                    <TableRow key={c.id} className="border-slate-200 dark:border-slate-800">
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        <span className="block truncate max-w-[min(100%,14rem)] sm:max-w-md">{c.nombre}</span>
                        {c.telefono?.trim() ? (
                          <span className="block text-xs font-normal text-slate-600 dark:text-slate-400">
                            {c.telefono.trim()}
                          </span>
                        ) : null}
                        {ultimoAbonoBadgeLabel(c) ? (
                          <span className="mt-1 inline-flex rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300">
                            {ultimoAbonoBadgeLabel(c)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-base font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        {formatMoney(saldoCliente(c))}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap border-slate-300 dark:border-slate-600"
                            onClick={() => {
                              setAbonoCliente(c);
                              setAbonoMonto('');
                            }}
                          >
                            Abonar
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap border-slate-300 dark:border-slate-600"
                            onClick={() => setHistorialCliente(c)}
                          >
                            <History className="mr-1.5 h-3.5 w-3.5" />
                            Historial
                          </Button>
                          {c.ultimoAbonoMonto != null &&
                          c.ultimoAbonoAt &&
                          c.ultimoAbonoSaldoAnterior != null &&
                          c.ultimoAbonoSaldoNuevo != null ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-cyan-500/40 text-cyan-700 hover:bg-cyan-500/10 dark:border-cyan-500/35 dark:text-cyan-300 dark:hover:bg-cyan-500/15"
                              onClick={() => {
                                const ultimo = listaAbonosCxCMostrable(c)[0];
                                printThermalClientAbonoReceipt({
                                  fechaLabel: formatInAppTimezone(c.ultimoAbonoAt!, {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  }),
                                  sucursalId: effectiveSucursalId ?? undefined,
                                  cajeroNombre: c.ultimoAbonoUsuarioNombre || undefined,
                                  clienteNombre: c.nombre,
                                  montoAbono: c.ultimoAbonoMonto!,
                                  formaPago: ultimo?.formaPago,
                                  saldoAnterior: c.ultimoAbonoSaldoAnterior!,
                                  saldoNuevo: c.ultimoAbonoSaldoNuevo!,
                                });
                              }}
                            >
                              <Printer className="mr-1.5 h-3.5 w-3.5" />
                              Reimprimir último abono
                            </Button>
                          ) : null}
                          {canDeleteCxC ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                              onClick={() => setEliminarClienteTarget(c)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Eliminar cuenta
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            </div>
          </div>
        </div>
      </div>


      <Dialog open={abonoCliente != null} onOpenChange={(o) => !o && cerrarAbono()}>
        <DialogContent className="border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar abono</DialogTitle>
            <p className="text-left text-sm font-normal text-slate-600 dark:text-slate-400">
              {abonoCliente?.nombre}
              {abonoCliente ?
                <>
                  {' '}
                  · Saldo actual{' '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {formatMoney(saldoCliente(abonoCliente))}
                  </span>
                </>
              : null}
            </p>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="abono-monto">Monto del abono</Label>
            <Input
              id="abono-monto"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={abonoMonto}
              onChange={(e) => setAbonoMonto(e.target.value)}
              className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
              autoComplete="off"
            />
            <div className="space-y-1">
              <Label>Forma de pago</Label>
              <Select
                value={abonoFormaPago}
                onValueChange={(v) => {
                  setAbonoFormaPago(v as FormaPago);
                  setAbonoFormaPagoCfdi(v);
                }}
              >
                <SelectTrigger className="border-slate-300 dark:border-slate-700 dark:bg-slate-800">
                  <SelectValue placeholder="Seleccione medio de pago" />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGO_UI.map((f) => (
                    <SelectItem key={f.clave} value={f.clave}>
                      {f.clave} — {f.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Este cobro se suma al corte de caja de la sesión abierta (efectivo, tarjeta, etc.).
              </p>
            </div>
            {canTimbrar && ppdFacturasCliente.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={emitirComplemento}
                    onChange={(e) => {
                      setEmitirComplemento(e.target.checked);
                      if (e.target.checked && !abonoFacturaId && ppdFacturasCliente[0]) {
                        setAbonoFacturaId(ppdFacturasCliente[0].id);
                      }
                    }}
                  />
                  Emitir complemento de pago CFDI (Facturama)
                </label>
                {emitirComplemento ? (
                  <>
                    <div className="space-y-1">
                      <Label>Factura PPD</Label>
                      <Select value={abonoFacturaId} onValueChange={setAbonoFacturaId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione factura" />
                        </SelectTrigger>
                        <SelectContent>
                          {ppdFacturasCliente.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.serie}-{inv.folio} · saldo {formatMoney(saldoInsolutoFacturaPpd(inv))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Forma de pago CFDI</Label>
                      <Select value={abonoFormaPagoCfdi} onValueChange={setAbonoFormaPagoCfdi}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAS_PAGO.map((f) => (
                            <SelectItem key={f.clave} value={f.clave}>
                              {f.clave} — {f.descripcion}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={cerrarAbono} disabled={abonoBusy}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
              disabled={abonoBusy}
              onClick={() => void confirmarAbono()}
            >
              {abonoBusy ? 'Guardando…' : 'Guardar abono'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={copiaClienteOpen}
        onOpenChange={(open) => {
          setCopiaClienteOpen(open);
          if (!open) setCopiaClientePayload(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Imprimir copia para el cliente?</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm">
              Ya se imprimió el comprobante marcado como «Tienda». Si lo desea, puede imprimir una segunda copia con
              leyenda «Copia cliente» para quien realizó el abono.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, gracias</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
              onClick={(e) => {
                e.preventDefault();
                if (copiaClientePayload) {
                  printThermalClientAbonoReceipt({ ...copiaClientePayload, copiaCliente: true });
                }
                setCopiaClienteOpen(false);
                setCopiaClientePayload(null);
              }}
            >
              Sí, imprimir copia cliente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      
      <AlertDialog
        open={eliminarClienteTarget != null}
        onOpenChange={(o) => {
          if (!o && !eliminarClienteBusy) setEliminarClienteTarget(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar toda la cuenta por cobrar del cliente?</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm">
              Se eliminará el saldo pendiente de{' '}
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                {formatMoney(saldoCliente(eliminarClienteTarget ?? ({} as Client)))}
              </span>{' '}
              de <span className="font-semibold">{eliminarClienteTarget?.nombre}</span>. Todos sus tickets con
              saldo quedarán liquidados y no afectará el corte de caja. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminarClienteBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700"
              disabled={eliminarClienteBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmarEliminarCliente();
              }}
            >
              {eliminarClienteBusy ? 'Eliminando…' : 'Sí, eliminar cuenta'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={historialCliente != null} onOpenChange={(o) => !o && setHistorialCliente(null)}>
        <DialogContent className="max-h-[min(85dvh,calc(100dvh-2rem))] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Historial de abonos</DialogTitle>
            <DialogDescription className="text-left text-sm text-slate-600 dark:text-slate-400">
              {historialCliente?.nombre}
            </DialogDescription>
          </DialogHeader>
          {historialCliente ?
            listaAbonosCxCMostrable(historialCliente).length === 0 ?
              <p className="py-2 text-sm text-slate-600 dark:text-slate-400">Sin abonos registrados.</p>
            : <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 hover:bg-transparent dark:border-slate-800">
                      <TableHead className="text-slate-700 dark:text-slate-300">Fecha</TableHead>
                      <TableHead className="text-right text-slate-700 dark:text-slate-300">Abono</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Pago</TableHead>
                      <TableHead className="text-right text-slate-700 dark:text-slate-300">Saldo después</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Cajero</TableHead>
                      {isAdmin ? (
                        <TableHead className="w-[1%] text-slate-700 dark:text-slate-300">Acciones</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listaAbonosCxCMostrable(historialCliente).map((row, idx) => (
                      <TableRow key={`${row.at.getTime()}-${idx}`} className="border-slate-200 dark:border-slate-800">
                        <TableCell className="whitespace-nowrap text-xs text-slate-800 dark:text-slate-200">
                          {formatInAppTimezone(row.at, { dateStyle: 'short', timeStyle: 'short' })}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-cyan-700 dark:text-cyan-400">
                          {formatMoney(row.monto)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700 dark:text-slate-300">
                          {row.formaPago ? labelFormaPago(row.formaPago) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {formatMoney(row.saldoNuevo)}
                        </TableCell>
                        <TableCell className="max-w-[8rem] truncate text-xs text-slate-600 dark:text-slate-400">
                          {row.usuarioNombre?.trim() || '—'}
                        </TableCell>
                        {isAdmin ? (
                          <TableCell>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-red-500/35 text-red-600 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-400"
                              onClick={() =>
                                setAbonoHistCancelTarget({ client: historialCliente, entry: row })
                              }
                            >
                              Cancelar
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
          : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHistorialCliente(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={abonoHistCancelTarget != null}
        onOpenChange={(o) => {
          if (!o && !abonoHistCancelBusy) setAbonoHistCancelTarget(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este abono?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p>
                  {abonoHistCancelTarget?.client.nombre} ·{' '}
                  <span className="font-semibold tabular-nums">
                    {formatMoney(abonoHistCancelTarget?.entry.monto ?? 0)}
                  </span>
                </p>
                <p>
                  Se restaurará el saldo pendiente, se quitará del corte de caja y los tickets volverán a
                  deber. Devuelva el dinero fuera del sistema si aplica.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={abonoHistCancelBusy}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={abonoHistCancelBusy || !effectiveSucursalId}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void (async () => {
                  if (!abonoHistCancelTarget || !effectiveSucursalId) return;
                  setAbonoHistCancelBusy(true);
                  try {
                    const { client, entry } = abonoHistCancelTarget;
                    await anularAbonoCxC({
                      sucursalId: effectiveSucursalId,
                      clienteId: client.id,
                      monto: entry.monto,
                      formaPago: entry.formaPago,
                      cajaSesionId: entry.cajaSesionId,
                      at: entry.at instanceof Date ? entry.at : new Date(entry.at),
                    });
                    addToast({
                      type: 'success',
                      message: `Abono de ${formatMoney(entry.monto)} anulado.`,
                      logToAppEvents: true,
                    });
                    setAbonoHistCancelTarget(null);
                    setHistorialCliente(null);
                  } catch (err) {
                    addToast({
                      type: 'error',
                      message: err instanceof Error ? err.message : 'No se pudo anular el abono',
                      logToAppEvents: true,
                    });
                  } finally {
                    setAbonoHistCancelBusy(false);
                  }
                })();
              }}
            >
              {abonoHistCancelBusy ? 'Anulando…' : 'Confirmar anulación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
