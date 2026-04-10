import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ShoppingCart, Ban, Printer } from 'lucide-react';
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
import { useSales } from '@/hooks/useSales';
import { useAppStore, useAuthStore } from '@/stores';
import type { Client, Sale, SaleItem } from '@/types';
import { formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { printThermalClientAbonoReceipt } from '@/lib/printTicket';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { parrafosAyudaCancelacionVentaAdmin } from '@/lib/cancelacionVentaAdminUi';
import { efectivoNetoEnCajaPorVenta } from '@/lib/cajaResumen';

function saldoCliente(c: Client): number {
  const v = Number(c.saldoAdeudado);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

function nombreClienteVenta(s: Sale): string {
  const n = s.cliente?.nombre?.trim();
  if (n) return n;
  if (s.clienteId && s.clienteId !== 'mostrador') return s.clienteId;
  return '—';
}

function totalPagadoVenta(s: Sale): number {
  const pagos = s.pagos ?? [];
  return Math.round(pagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0) * 100) / 100;
}

function lineaDescripcion(item: SaleItem): string {
  const n = item.productoNombre?.trim() || item.producto?.nombre?.trim();
  return n || 'Artículo';
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
  const navigate = useNavigate();
  const { clients, loading: loadingClients, registrarAbonoCuenta } = useClients();
  const { sales, loading: loadingSales, cancelSale } = useSales(500);
  const { addToast } = useAppStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const puedeIrPos = hasPermission('ventas:crear');

  const deudores = useMemo(() => {
    const rows = clients.filter((c) => !c.isMostrador && saldoCliente(c) > 0.005);
    rows.sort((a, b) => saldoCliente(b) - saldoCliente(a));
    return rows;
  }, [clients]);

  const ticketsConSaldo = useMemo(() => {
    const rows = sales
      .filter((s) => s.estado === 'completada')
      .map((s) => ({ sale: s, adeudo: computeSaleClienteAdeudo(s) }))
      .filter((x) => x.adeudo > 0.005);
    rows.sort((a, b) => b.sale.createdAt.getTime() - a.sale.createdAt.getTime());
    return rows;
  }, [sales]);

  /** Suma real de saldos pendientes (incluye mostrador y tickets sin reflejar aún en `cliente.saldoAdeudado`). */
  const totalSaldoPendienteTickets = useMemo(
    () =>
      Math.round(ticketsConSaldo.reduce((s, x) => s + x.adeudo, 0) * 100) / 100,
    [ticketsConSaldo]
  );

  const loading = loadingClients || loadingSales;

  const [abonoCliente, setAbonoCliente] = useState<Client | null>(null);
  const [abonoMonto, setAbonoMonto] = useState('');
  const [abonoBusy, setAbonoBusy] = useState(false);

  const [ticketSeleccionado, setTicketSeleccionado] = useState<{
    sale: Sale;
    adeudo: number;
  } | null>(null);
  const [cancelTicketConfirmOpen, setCancelTicketConfirmOpen] = useState(false);
  const [cancelTicketBusy, setCancelTicketBusy] = useState(false);

  const cerrarAbono = () => {
    setAbonoCliente(null);
    setAbonoMonto('');
  };

  const confirmarAbono = async () => {
    if (!abonoCliente) return;
    const norm = abonoMonto.replace(',', '.').trim();
    const m = parseFloat(norm);
    if (!Number.isFinite(m) || m <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto válido mayor a cero.' });
      return;
    }
    setAbonoBusy(true);
    try {
      const saldoAnterior = saldoCliente(abonoCliente);
      await registrarAbonoCuenta(abonoCliente.id, m, {
        usuarioNombre: user?.name?.trim() || user?.email || undefined,
      });
      const saldoNuevo = Math.max(0, Math.round((saldoAnterior - m) * 100) / 100);
      printThermalClientAbonoReceipt({
        fechaLabel: formatInAppTimezone(new Date(), { dateStyle: 'short', timeStyle: 'short' }),
        sucursalId: effectiveSucursalId,
        cajeroNombre: user?.name?.trim() || user?.email || undefined,
        clienteNombre: abonoCliente.nombre,
        montoAbono: m,
        saldoAnterior,
        saldoNuevo,
      });
      addToast({ type: 'success', message: `Abono registrado: ${formatMoney(m)}`, logToAppEvents: true });
      cerrarAbono();
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

  const confirmarCancelarTicket = async () => {
    if (!ticketSeleccionado) return;
    const saleSnap = ticketSeleccionado.sale;
    setCancelTicketBusy(true);
    try {
      await cancelSale(saleSnap.id, {
        motivo: 'Cancelación desde cuentas por cobrar',
        cancelacionMotivo: 'panel',
      });
      const efDev = efectivoNetoEnCajaPorVenta(saleSnap);
      addToast({
        type: 'success',
        message: `Venta ${saleSnap.folio} cancelada. Inventario reintegrado.${efDev > 0.005 ? ` Devolución en efectivo: ${formatMoney(efDev)}.` : ''}`,
        logToAppEvents: true,
      });
      setCancelTicketConfirmOpen(false);
      setTicketSeleccionado(null);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cancelar la venta',
        logToAppEvents: true,
      });
    } finally {
      setCancelTicketBusy(false);
    }
  };

  return (
    <PageShell title="Cuentas por cobrar">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5 dark:border-slate-800/50 dark:bg-slate-900/50 sm:px-4">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <Wallet className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Total por cobrar</p>
              <p className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                {formatMoney(totalSaldoPendienteTickets)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">
            {deudores.length} cliente{deudores.length === 1 ? '' : 's'} · {ticketsConSaldo.length} ticket
            {ticketsConSaldo.length === 1 ? '' : 's'} con saldo
            <span className="hidden sm:inline"> (últimos movimientos sincronizados)</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/50">
            <div className="border-b border-slate-200/80 px-3 py-2 dark:border-slate-800/50 sm:px-4">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Tickets con saldo pendiente
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 sm:text-xs">
                Incluye ventas con forma «Pendiente de pago» y cobros parciales (PPD). El listado refleja las
                ventas recientes cargadas en el dispositivo (hasta ~500 en nube).
              </p>
            </div>
            {loading ? (
              <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">Cargando…</p>
            ) : ticketsConSaldo.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">
                No hay tickets con saldo en el periodo cargado. En el POS use{' '}
                <span className="font-medium text-slate-800 dark:text-slate-200">Pendiente de pago</span> o{' '}
                <span className="font-medium text-slate-800 dark:text-slate-200">Parcialidades (PPD)</span> con
                cliente registrado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-700 dark:text-slate-300">Folio</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Cliente</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Fecha</TableHead>
                    <TableHead className="text-right text-slate-700 dark:text-slate-300">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticketsConSaldo.map(({ sale, adeudo }) => (
                    <TableRow
                      key={sale.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer border-slate-200 transition-colors hover:bg-slate-100/90 dark:border-slate-800 dark:hover:bg-slate-800/50"
                      onClick={() => setTicketSeleccionado({ sale, adeudo })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setTicketSeleccionado({ sale, adeudo });
                        }
                      }}
                    >
                      <TableCell className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                        {sale.folio?.trim() || sale.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="max-w-[min(100%,12rem)] truncate text-slate-900 dark:text-slate-100 sm:max-w-md">
                        {nombreClienteVenta(sale)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                        {formatInAppTimezone(sale.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell className="text-right text-base font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        {formatMoney(adeudo)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/50">
            <div className="border-b border-slate-200/80 px-3 py-2 dark:border-slate-800/50 sm:px-4">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Abonos por cliente
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 sm:text-xs">
                Los abonos reducen el saldo global del cliente y generan comprobante térmico para el cliente.
              </p>
            </div>
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
                          {c.ultimoAbonoMonto != null &&
                          c.ultimoAbonoAt &&
                          c.ultimoAbonoSaldoAnterior != null &&
                          c.ultimoAbonoSaldoNuevo != null ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap border-cyan-500/40 text-cyan-700 hover:bg-cyan-500/10 dark:border-cyan-500/35 dark:text-cyan-300 dark:hover:bg-cyan-500/15"
                              onClick={() =>
                                printThermalClientAbonoReceipt({
                                  fechaLabel: formatInAppTimezone(c.ultimoAbonoAt!, {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  }),
                                  sucursalId: effectiveSucursalId,
                                  cajeroNombre: c.ultimoAbonoUsuarioNombre || undefined,
                                  clienteNombre: c.nombre,
                                  montoAbono: c.ultimoAbonoMonto!,
                                  saldoAnterior: c.ultimoAbonoSaldoAnterior!,
                                  saldoNuevo: c.ultimoAbonoSaldoNuevo!,
                                })
                              }
                            >
                              <Printer className="mr-1.5 h-3.5 w-3.5" />
                              Reimprimir último abono
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

      <Dialog
        open={ticketSeleccionado != null}
        onOpenChange={(o) => {
          if (!o) {
            setTicketSeleccionado(null);
            setCancelTicketConfirmOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[min(92dvh,calc(100dvh-2rem))] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ticket con saldo</DialogTitle>
            <DialogDescription className="text-left text-sm text-slate-600 dark:text-slate-400">
              {ticketSeleccionado?.sale.folio?.trim() || ticketSeleccionado?.sale.id.slice(0, 8)} ·{' '}
              {ticketSeleccionado ? nombreClienteVenta(ticketSeleccionado.sale) : ''}
            </DialogDescription>
          </DialogHeader>
          {ticketSeleccionado ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-slate-200/80 bg-slate-100/80 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-800/50">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Total venta{' '}
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(Number(ticketSeleccionado.sale.total) || 0)}
                  </span>
                  {' · '}
                  Pagado{' '}
                  <span className="tabular-nums">{formatMoney(totalPagadoVenta(ticketSeleccionado.sale))}</span>
                  {' · '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    Saldo {formatMoney(ticketSeleccionado.adeudo)}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                  {formatInAppTimezone(ticketSeleccionado.sale.createdAt, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
                  Líneas
                </p>
                <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
                  {(ticketSeleccionado.sale.productos ?? []).map((item) => (
                    <li
                      key={item.id}
                      className="flex justify-between gap-2 border-b border-slate-200/60 pb-1 dark:border-slate-700/50"
                    >
                      <span className="min-w-0 truncate">{lineaDescripcion(item)}</span>
                      <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-300">
                        ×{item.cantidad} · {formatMoney(Number(item.total) || 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 dark:border-slate-600"
              onClick={() => setTicketSeleccionado(null)}
            >
              Cerrar
            </Button>
            {puedeIrPos && ticketSeleccionado ? (
              <Button
                type="button"
                className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                onClick={() => {
                  const id = ticketSeleccionado.sale.id;
                  setTicketSeleccionado(null);
                  navigate('/pos', { state: { posAbrirVentaId: id } });
                }}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Abrir venta
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                type="button"
                variant="destructive"
                className="bg-red-600 hover:bg-red-700"
                disabled={Boolean(ticketSeleccionado?.sale.facturaId)}
                onClick={() => setCancelTicketConfirmOpen(true)}
              >
                <Ban className="mr-2 h-4 w-4" />
                Cancelar venta
              </Button>
            ) : null}
          </DialogFooter>
          {!isAdmin ? (
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Solo un administrador puede cancelar ventas desde esta pantalla.
            </p>
          ) : null}
          {isAdmin && ticketSeleccionado?.sale.facturaId ? (
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Las ventas ya facturadas no se pueden cancelar desde aquí.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelTicketConfirmOpen} onOpenChange={setCancelTicketConfirmOpen}>
        <AlertDialogContent className="border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta venta?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm text-slate-600 dark:text-slate-400">
                {ticketSeleccionado ? (
                  <>
                    <p>
                      Ticket{' '}
                      <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {ticketSeleccionado.sale.folio}
                      </span>
                    </p>
                    <ul className="list-disc space-y-1.5 pl-5">
                      {parrafosAyudaCancelacionVentaAdmin(ticketSeleccionado.sale).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>Confirme la cancelación.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelTicketBusy}>No</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={cancelTicketBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmarCancelarTicket();
              }}
            >
              {cancelTicketBusy ? 'Cancelando…' : 'Sí, cancelar venta'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </PageShell>
  );
}
