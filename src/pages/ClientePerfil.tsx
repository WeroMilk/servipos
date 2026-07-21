import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  Edit2,
  FileQuestion,
  FileText,
  Gift,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Printer,
  Receipt,
  Ticket,
  Wallet,
} from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useClients,
  useClientDetails,
  useCajaSesion,
  useEffectiveSucursalId,
  useInvoices,
  useQuotations,
  useSales,
} from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Client, ClientAbonoHistorialEntry, Invoice, Quotation, QuotationStatus, Sale, SaleItem } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { anularAbonoCxC, getSalesByClienteId } from '@/db/database';
import { saleCuentaComoCompraCliente } from '@/lib/saleClienteHistorial';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { saleIsInvoiced } from '@/lib/saleInvoiced';
import { saleListaCancelacionEtiqueta } from '@/lib/saleCancelacion';
import {
  printLetterDocument,
  printThermalClientCreditoReceipt,
  printThermalClientStatusReport,
  printThermalQuotation,
  printThermalTicketFromSale,
} from '@/lib/printTicket';
import { buildQuotationLetterInnerHtml } from '@/lib/quotationPdfExport';
import { printInvoiceCfdiRepresentacion } from '@/lib/cfdiRepresentacionImpresa';
import { listaAbonosCxCMostrable } from '@/lib/clientAbonoHistorialUi';
import { listaCreditoTiendaMostrable } from '@/lib/clientCreditoHistorialUi';
import {
  CREDITO_TIENDA_MOTIVOS_EMISION,
  labelCreditoTiendaMotivo,
  labelCreditoTiendaTipo,
  saldoCreditoCliente,
  type CreditoTiendaMotivoEmisionId,
} from '@/lib/clientCreditoTienda';
import { useClientPriceListCatalog } from '@/hooks/useClientPriceListCatalog';
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

type ProfileTab = 'resumen' | 'compras' | 'facturas' | 'cotizaciones' | 'adeudos' | 'credito';

type AdeudoTicketRow = { sale: Sale; adeudo: number };

const VALID_TABS: ProfileTab[] = ['resumen', 'compras', 'facturas', 'cotizaciones', 'adeudos', 'credito'];

const QUOTATION_ESTADO_LABEL: Record<QuotationStatus, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  convertida: 'Convertida',
};

const INVOICE_ESTADO_LABEL: Record<Invoice['estado'], string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  timbrada: 'Timbrada',
  cancelada: 'Cancelada',
  error: 'Error',
};

function saldoCliente(c: Client): number {
  const v = Number(c.saldoAdeudado);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

function buildAdeudosTicketsForCliente(clientId: string, sales: Sale[]): AdeudoTicketRow[] {
  const cid = clientId.trim();
  if (!cid || cid === 'mostrador') return [];
  const rows: AdeudoTicketRow[] = [];
  for (const sale of sales) {
    if (sale.estado !== 'completada') continue;
    const adeudo = computeSaleClienteAdeudo(sale);
    if (adeudo <= 0.005) continue;
    if ((sale.clienteId ?? '').trim() !== cid) continue;
    rows.push({ sale, adeudo });
  }
  rows.sort((a, b) => b.sale.createdAt.getTime() - a.sale.createdAt.getTime());
  return rows;
}

function totalAdeudoTickets(rows: readonly AdeudoTicketRow[]): number {
  return Math.round(rows.reduce((s, x) => s + x.adeudo, 0) * 100) / 100;
}

function totalPagadoVenta(s: Sale): number {
  return (s.pagos ?? []).reduce((sum, p) => sum + (Number(p.monto) || 0), 0);
}

function lineaDescripcion(item: SaleItem): string {
  const n = item.productoNombre?.trim() || item.producto?.nombre?.trim();
  return n || 'Artículo';
}

function saleEstadoEtiqueta(s: Sale): string {
  if (s.estado === 'pendiente') return 'Pendiente de cobro';
  if (s.estado === 'cancelada') return 'Cancelada';
  if (s.estado === 'facturada') return 'Facturada';
  return 'Completada';
}

function printQuotationLetter(q: Quotation, fallbackSucursalId?: string | null): void {
  printLetterDocument(`Cotización ${q.folio}`, buildQuotationLetterInnerHtml(q), {
    sucursalId: q.sucursalId ?? fallbackSucursalId ?? null,
  });
}

function parseTab(value: string | null): ProfileTab {
  if (value && VALID_TABS.includes(value as ProfileTab)) return value as ProfileTab;
  return 'resumen';
}

export function ClientePerfil() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseTab(searchParams.get('tab'));

  const { clients, emitirCreditoTienda } = useClients();
  const { client: clientFromDb, loading: loadingDetails } = useClientDetails(clientId ?? null);
  const { sales } = useSales(500);
  const { quotations, loading: loadingQuotations } = useQuotations();
  const { invoices, loading: loadingInvoices } = useInvoices();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const cajaSesion = useCajaSesion({ sucursalId: effectiveSucursalId });
  const { addToast } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const priceListCatalog = useClientPriceListCatalog();

  const [creditoDialogOpen, setCreditoDialogOpen] = useState(false);
  const [creditoMonto, setCreditoMonto] = useState('');
  const [creditoMotivo, setCreditoMotivo] = useState<CreditoTiendaMotivoEmisionId>(
    'devolucion_sin_reembolso'
  );
  const [creditoReferencia, setCreditoReferencia] = useState('');
  const [creditoNotas, setCreditoNotas] = useState('');
  const [creditoBusy, setCreditoBusy] = useState(false);
  const [abonoCancelEntry, setAbonoCancelEntry] = useState<ClientAbonoHistorialEntry | null>(null);
  const [abonoCancelBusy, setAbonoCancelBusy] = useState(false);

  const client = useMemo(() => {
    if (!clientId) return null;
    return clients.find((c) => c.id === clientId) ?? clientFromDb;
  }, [clientId, clients, clientFromDb]);

  const [clientSales, setClientSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedAdeudo, setSelectedAdeudo] = useState<AdeudoTicketRow | null>(null);

  useEffect(() => {
    if (!clientId || clientId === 'mostrador') {
      setClientSales([]);
      setLoadingSales(false);
      return;
    }
    let cancelled = false;
    setLoadingSales(true);
    void getSalesByClienteId(clientId, { sucursalId: effectiveSucursalId })
      .then((rows) => {
        if (!cancelled) setClientSales(rows.filter(saleCuentaComoCompraCliente));
      })
      .catch(() => {
        if (!cancelled) setClientSales([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSales(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, effectiveSucursalId]);

  const clientQuotations = useMemo(() => {
    if (!clientId) return [];
    return quotations
      .filter((q) => (q.clienteId ?? '').trim() === clientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [quotations, clientId]);

  const clientInvoices = useMemo(() => {
    if (!clientId) return [];
    return invoices
      .filter((inv) => (inv.clienteId ?? '').trim() === clientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [invoices, clientId]);

  const adeudosTickets = useMemo(() => {
    if (!clientId) return [];
    return buildAdeudosTicketsForCliente(clientId, sales);
  }, [clientId, sales]);

  const totalGastado = useMemo(
    () =>
      Math.round(
        clientSales
          .filter((s) => s.estado !== 'cancelada' && s.estado !== 'pendiente')
          .reduce((sum, s) => sum + (Number(s.total) || 0), 0) * 100
      ) / 100,
    [clientSales]
  );

  const saldoPendiente = useMemo(() => {
    const fromClient = client ? saldoCliente(client) : 0;
    const fromTickets = totalAdeudoTickets(adeudosTickets);
    return Math.round(Math.max(fromClient, fromTickets) * 100) / 100;
  }, [client, adeudosTickets]);

  const totalAbonado = useMemo(() => {
    if (!client) return 0;
    return Math.round(
      listaAbonosCxCMostrable(client).reduce((s, e) => s + (Number(e.monto) || 0), 0) * 100
    ) / 100;
  }, [client]);

  const abonosHistorial = useMemo(
    () => (client ? listaAbonosCxCMostrable(client) : []),
    [client]
  );

  const creditoHistorial = useMemo(
    () => (client ? listaCreditoTiendaMostrable(client) : []),
    [client]
  );

  const saldoCredito = useMemo(() => (client ? saldoCreditoCliente(client) : 0), [client]);

  const handlePrintStatus = () => {
    if (!client) return;
    printThermalClientStatusReport({
      fechaLabel: formatInAppTimezone(new Date(), { dateStyle: 'full', timeStyle: 'short' }),
      sucursalId: effectiveSucursalId ?? undefined,
      client,
      stats: {
        totalCompras: clientSales.length,
        totalGastado,
        saldoPendiente,
        numFacturas: clientInvoices.length,
        numCotizaciones: clientQuotations.length,
        numAdeudos: adeudosTickets.length,
        totalAbonado,
      },
      ventasRecientes: clientSales.slice(0, 12).map((s) => ({
        folio: s.folio?.trim() || s.id.slice(0, 8),
        total: Number(s.total) || 0,
        fecha: formatInAppTimezone(s.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
        estado: saleEstadoEtiqueta(s),
      })),
      facturasRecientes: clientInvoices.slice(0, 8).map((inv) => ({
        folioSerie: `${inv.serie}-${inv.folio}`,
        total: Number(inv.total) || 0,
        fecha: formatInAppTimezone(inv.fechaEmision, { dateStyle: 'short' }),
        estado: INVOICE_ESTADO_LABEL[inv.estado] ?? inv.estado,
      })),
      cotizacionesRecientes: clientQuotations.slice(0, 8).map((q) => ({
        folio: q.folio,
        total: Number(q.total) || 0,
        fecha: formatInAppTimezone(q.createdAt, { dateStyle: 'short' }),
        estado: QUOTATION_ESTADO_LABEL[q.estado] ?? q.estado,
      })),
    });
    addToast({ type: 'success', message: 'Estado de cliente enviado a imprimir' });
  };

  const resetCreditoForm = () => {
    setCreditoMonto('');
    setCreditoMotivo('devolucion_sin_reembolso');
    setCreditoReferencia('');
    setCreditoNotas('');
  };

  const confirmarCreditoTienda = async () => {
    if (!client) return;
    const norm = creditoMonto.replace(',', '.').trim();
    const m = parseFloat(norm);
    if (!Number.isFinite(m) || m <= 0) {
      addToast({ type: 'error', message: 'Ingrese un monto válido mayor a cero' });
      return;
    }
    setCreditoBusy(true);
    try {
      const cajero =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
      const { saldoAnterior, saldoNuevo } = await emitirCreditoTienda(client.id, m, {
        usuarioNombre: cajero,
        usuarioId: user?.id,
        motivo: creditoMotivo,
        referencia: creditoReferencia.trim() || undefined,
        notas: creditoNotas.trim() || undefined,
        cajaSesionId: cajaSesion.activa?.id,
      });
      const fechaLabel = formatInAppTimezone(new Date(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      printThermalClientCreditoReceipt({
        fechaLabel,
        sucursalId: effectiveSucursalId ?? undefined,
        cajeroNombre: cajero,
        clienteNombre: client.nombre,
        montoCredito: m,
        saldoAnterior,
        saldoNuevo,
        motivoLabel: labelCreditoTiendaMotivo(creditoMotivo),
        notas: creditoNotas.trim() || undefined,
      });
      printThermalClientCreditoReceipt({
        fechaLabel,
        sucursalId: effectiveSucursalId ?? undefined,
        cajeroNombre: cajero,
        clienteNombre: client.nombre,
        montoCredito: m,
        saldoAnterior,
        saldoNuevo,
        motivoLabel: labelCreditoTiendaMotivo(creditoMotivo),
        notas: creditoNotas.trim() || undefined,
        copiaCliente: true,
      });
      addToast({
        type: 'success',
        message: `Crédito de tienda otorgado: ${formatMoney(m)}. Saldo disponible: ${formatMoney(saldoNuevo)}`,
      });
      setCreditoDialogOpen(false);
      resetCreditoForm();
      setTab('credito');
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo otorgar el crédito',
      });
    } finally {
      setCreditoBusy(false);
    }
  };

  const setTab = (tab: ProfileTab) => {
    setSearchParams(tab === 'resumen' ? {} : { tab }, { replace: true });
    setSelectedSale(null);
    setSelectedAdeudo(null);
  };

  if (!clientId || clientId === 'mostrador') {
    return <Navigate to="/clientes" replace />;
  }

  if (!client && !loadingDetails) {
    return (
      <PageShell title="Cliente no encontrado" subtitle="El registro no existe o fue eliminado">
        <Button type="button" variant="outline" onClick={() => navigate('/clientes')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a clientes
        </Button>
      </PageShell>
    );
  }

  const loading = !client && loadingDetails;

  return (
    <PageShell
      title={client?.nombre ?? 'Cargando…'}
      subtitle={client?.razonSocial?.trim() || client?.rfc || 'Perfil del cliente'}
      className="min-w-0 max-w-none"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/clientes')}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Clientes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!client}
            onClick={handlePrintStatus}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            Estado de cuenta
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!client}
            className="bg-gradient-to-r from-violet-500 to-purple-600 text-white"
            onClick={() => {
              resetCreditoForm();
              setCreditoDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Crédito de tienda
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!client}
            className="bg-brand-gradient text-white"
            onClick={() =>
              navigate('/clientes', { state: { editClientId: client?.id } })
            }
          >
            <Edit2 className="mr-1.5 h-4 w-4" />
            Editar
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
        </div>
      ) : client ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-hidden max-md:flex-none max-md:overflow-y-visible">
          <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 md:gap-2 xl:grid-cols-7">
            <StatCard
              label="Compras"
              value={String(clientSales.length)}
              icon={<Ticket className="h-4 w-4 text-amber-500" />}
              onClick={() => setTab('compras')}
            />
            <StatCard
              label="Total gastado"
              value={formatMoney(totalGastado)}
              icon={<Receipt className="h-4 w-4 text-brand" />}
            />
            <StatCard
              label="Saldo pendiente"
              value={formatMoney(saldoPendiente)}
              icon={<Wallet className="h-4 w-4 text-red-500" />}
              highlight={saldoPendiente > 0.005 ? 'danger' : 'success'}
              onClick={() => setTab('adeudos')}
            />
            <StatCard
              label="Facturas"
              value={String(clientInvoices.length)}
              icon={<FileText className="h-4 w-4 text-emerald-500" />}
              onClick={() => setTab('facturas')}
            />
            <StatCard
              label="Cotizaciones"
              value={String(clientQuotations.length)}
              icon={<FileQuestion className="h-4 w-4 text-violet-500" />}
              onClick={() => setTab('cotizaciones')}
            />
            <StatCard
              label="Crédito tienda"
              value={formatMoney(saldoCredito)}
              icon={<Gift className="h-4 w-4 text-violet-500" />}
              highlight={saldoCredito > 0.005 ? 'success' : undefined}
              onClick={() => setTab('credito')}
            />
            <StatCard
              label="Abonos"
              value={formatMoney(totalAbonado)}
              icon={<BadgeCheck className="h-4 w-4 text-brand" />}
              onClick={() => setTab('adeudos')}
            />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setTab(parseTab(v))}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden max-md:flex-none max-md:overflow-visible"
          >
            <TabsList className="h-auto w-full shrink-0 flex-wrap justify-start bg-slate-100/90 p-1 dark:bg-slate-900/80">
              <TabsTrigger value="resumen" className="text-xs sm:text-sm">
                Resumen
              </TabsTrigger>
              <TabsTrigger value="compras" className="text-xs sm:text-sm">
                Compras ({clientSales.length})
              </TabsTrigger>
              <TabsTrigger value="facturas" className="text-xs sm:text-sm">
                Facturas ({clientInvoices.length})
              </TabsTrigger>
              <TabsTrigger value="cotizaciones" className="text-xs sm:text-sm">
                Cotizaciones ({clientQuotations.length})
              </TabsTrigger>
              <TabsTrigger value="adeudos" className="text-xs sm:text-sm">
                Adeudos ({adeudosTickets.length})
              </TabsTrigger>
              <TabsTrigger value="credito" className="text-xs sm:text-sm">
                Crédito ({formatMoney(saldoCredito)})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="resumen" className="mt-0 min-h-0 flex-1 overflow-auto max-md:flex-none max-md:overflow-visible">
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Datos del cliente</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <InfoRow label="Lista de precios">
                      {priceListCatalog.labels[client.listaPreciosId ?? 'regular'] ?? 'Regular'}
                    </InfoRow>
                    {client.rfc ? (
                      <InfoRow label="RFC">
                        <span className="text-emerald-600 dark:text-emerald-400">{client.rfc}</span>
                      </InfoRow>
                    ) : null}
                    {client.email ? (
                      <InfoRow label="Email">
                        <Mail className="mr-1 inline h-3.5 w-3.5" />
                        {client.email}
                      </InfoRow>
                    ) : null}
                    {client.telefono ? (
                      <InfoRow label="Teléfono">
                        <Phone className="mr-1 inline h-3.5 w-3.5" />
                        {client.telefono}
                      </InfoRow>
                    ) : null}
                    {client.direccion ? (
                      <InfoRow label="Dirección">
                        <MapPin className="mr-1 inline h-3.5 w-3.5 shrink-0" />
                        {client.direccion.calle} {client.direccion.numeroExterior}{' '}
                        {client.direccion.colonia}, {client.direccion.ciudad},{' '}
                        {client.direccion.estado} CP {client.direccion.codigoPostal}
                      </InfoRow>
                    ) : null}
                    {client.notasInternas?.trim() ? (
                      <InfoRow label="Notas internas">
                        <p className="whitespace-pre-wrap rounded-md border border-slate-200/80 bg-white/60 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/40">
                          {client.notasInternas.trim()}
                        </p>
                      </InfoRow>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Estado de cuenta</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200/80 px-3 py-2 dark:border-slate-700/60">
                      <span className="text-slate-600 dark:text-slate-400">Total gastado</span>
                      <span className="font-semibold tabular-nums text-brand dark:text-brand">
                        {formatMoney(totalGastado)}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-3 py-2',
                        saldoPendiente > 0.005
                          ? 'border-red-300/60 bg-red-500/10 dark:border-red-800/50'
                          : 'border-emerald-300/60 bg-emerald-500/10 dark:border-emerald-800/50'
                      )}
                    >
                      <span className="text-slate-700 dark:text-slate-300">
                        {saldoPendiente > 0.005 ? 'Saldo pendiente' : 'Al corriente'}
                      </span>
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          saldoPendiente > 0.005
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {saldoPendiente > 0.005 ? formatMoney(saldoPendiente) : '$0.00'}
                      </span>
                    </div>
                    {totalAbonado > 0.005 ? (
                      <div className="flex items-center justify-between rounded-lg border border-slate-200/80 px-3 py-2 dark:border-slate-700/60">
                        <span className="text-slate-600 dark:text-slate-400">Abonos registrados</span>
                        <span className="font-semibold tabular-nums">{formatMoney(totalAbonado)}</span>
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-3 py-2',
                        saldoCredito > 0.005
                          ? 'border-violet-300/60 bg-violet-500/10 dark:border-violet-800/50'
                          : 'border-slate-200/80 dark:border-slate-700/60'
                      )}
                    >
                      <span className="text-slate-700 dark:text-slate-300">Crédito de tienda</span>
                      <span className="font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                        {formatMoney(saldoCredito)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {saldoPendiente > 0.005 ? (
                        <Button type="button" size="sm" variant="outline" asChild>
                          <Link to="/cuentas-por-cobrar">Ir a Cuentas por cobrar</Link>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          resetCreditoForm();
                          setCreditoDialogOpen(true);
                        }}
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Otorgar crédito
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={handlePrintStatus}>
                        <Printer className="mr-1.5 h-4 w-4" />
                        Imprimir estado
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {clientSales.length > 0 ? (
                <Card className="mt-3 border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base">Últimas compras</CardTitle>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setTab('compras')}>
                      Ver todas
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <CompactSalesTable sales={clientSales.slice(0, 5)} onSelect={setSelectedSale} />
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="compras" className="mt-0 min-h-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
              <EntityListPanel
                title="Compras"
                loading={loadingSales}
                backLabel="Volver al listado"
                selected={selectedSale}
                onBack={() => setSelectedSale(null)}
                selectedTitle={selectedSale ? `Ticket ${selectedSale.folio}` : undefined}
                list={
                  clientSales.length === 0 ? (
                    <EmptyBlock message="No hay compras registradas para este cliente." />
                  ) : (
                    <ul className="space-y-2">
                    {clientSales.map((sale) => (
                      <li key={sale.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-1 rounded-lg border border-slate-200/80 p-3 text-left transition-colors hover:bg-slate-200/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                          onClick={() => setSelectedSale(sale)}
                        >
                          <SaleListRow sale={sale} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  )
                }
                detail={
                  selectedSale ? (
                    <SaleDetailPanel
                      sale={selectedSale}
                      onPrint={() => void printThermalTicketFromSale(selectedSale)}
                    />
                  ) : null
                }
              />
            </TabsContent>

            <TabsContent value="facturas" className="mt-0 min-h-0 flex-1 overflow-auto max-md:flex-none max-md:overflow-visible">
              {loadingInvoices ? (
                <LoadingBlock message="Cargando facturas…" />
              ) : clientInvoices.length === 0 ? (
                <EmptyBlock message="No hay facturas para este cliente." />
              ) : (
                <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Folio</TableHead>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientInvoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium">
                              {inv.serie}-{inv.folio}
                              {inv.uuid ? (
                                <p className="truncate text-xs text-slate-500">{inv.uuid.slice(0, 13)}…</p>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {formatInAppTimezone(inv.fechaEmision, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{INVOICE_ESTADO_LABEL[inv.estado]}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMoney(inv.total)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={inv.estado === 'cancelada' || inv.estado === 'error'}
                                onClick={() => {
                                  printInvoiceCfdiRepresentacion(inv);
                                  addToast({ type: 'success', message: 'Factura enviada a imprimir' });
                                }}
                              >
                                <Printer className="mr-1.5 h-3.5 w-3.5" />
                                Reimprimir
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="cotizaciones" className="mt-0 min-h-0 flex-1 overflow-auto max-md:flex-none max-md:overflow-visible">
              {loadingQuotations ? (
                <LoadingBlock message="Cargando cotizaciones…" />
              ) : clientQuotations.length === 0 ? (
                <EmptyBlock message="No hay cotizaciones para este cliente." />
              ) : (
                <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Folio</TableHead>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Vigencia</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Imprimir</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientQuotations.map((q) => (
                          <TableRow key={q.id}>
                            <TableCell className="font-medium">{q.folio}</TableCell>
                            <TableCell>
                              {formatInAppTimezone(q.createdAt, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </TableCell>
                            <TableCell>
                              {formatInAppTimezone(q.fechaVigencia, { dateStyle: 'short' })}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{QUOTATION_ESTADO_LABEL[q.estado]}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMoney(q.total)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => printQuotationLetter(q, effectiveSucursalId)}
                                >
                                  Carta
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    printThermalQuotation(q, { sucursalId: effectiveSucursalId })
                                  }
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="adeudos" className="mt-0 min-h-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
              <EntityListPanel
                title="Adeudos y abonos"
                loading={false}
                backLabel="Volver al listado"
                selected={selectedAdeudo}
                onBack={() => setSelectedAdeudo(null)}
                selectedTitle={
                  selectedAdeudo
                    ? `Ticket ${selectedAdeudo.sale.folio?.trim() || selectedAdeudo.sale.id.slice(0, 8)}`
                    : undefined
                }
                headerExtra={
                  adeudosTickets.length > 0 ? (
                    <p className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                      Saldo total: {formatMoney(totalAdeudoTickets(adeudosTickets))}
                    </p>
                  ) : null
                }
                list={
                  <div className="space-y-4">
                    {adeudosTickets.length > 0 ? (
                      <ul className="space-y-2">
                        {adeudosTickets.map(({ sale, adeudo }) => (
                          <li key={sale.id}>
                            <button
                              type="button"
                              className="flex w-full flex-col gap-1 rounded-lg border border-red-200/80 bg-red-500/5 p-3 text-left transition-colors hover:bg-red-500/10 dark:border-red-900/50 dark:bg-red-500/10"
                              onClick={() => setSelectedAdeudo({ sale, adeudo })}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 font-medium">
                                  <Wallet className="h-4 w-4 text-red-600" />
                                  {sale.folio?.trim() || sale.id.slice(0, 8)}
                                </span>
                                <span className="font-semibold tabular-nums text-red-700 dark:text-red-400">
                                  {formatMoney(adeudo)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-500">
                                Total {formatMoney(sale.total)} · Pagado {formatMoney(totalPagadoVenta(sale))}
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {abonosHistorial.length > 0 ? (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          Historial de abonos
                        </h3>
                        <ul className="space-y-2">
                          {abonosHistorial.map((entry, idx) => (
                            <li
                              key={`${entry.at.getTime()}-${idx}`}
                              className="rounded-lg border border-slate-200/80 px-3 py-2 text-sm dark:border-slate-700/60"
                            >
                              <div className="flex justify-between gap-2">
                                <span>
                                  {formatInAppTimezone(entry.at, {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </span>
                                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                  {formatMoney(entry.monto)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-500">
                                Saldo {formatMoney(entry.saldoAnterior)} → {formatMoney(entry.saldoNuevo)}
                                {entry.formaPago ? ` · pago ${entry.formaPago}` : ''}
                                {entry.usuarioNombre ? ` · ${entry.usuarioNombre}` : ''}
                              </p>
                              {isAdmin ? (
                                <div className="mt-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 border-red-500/35 text-xs text-red-600 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-400"
                                    onClick={() => setAbonoCancelEntry(entry)}
                                  >
                                    Cancelar abono
                                  </Button>
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {adeudosTickets.length === 0 && abonosHistorial.length === 0 ? (
                      <EmptyBlock message="Sin adeudos ni abonos registrados." />
                    ) : null}
                  </div>
                }
                detail={
                  selectedAdeudo ? (
                    <AdeudoDetailPanel
                      row={selectedAdeudo}
                      onPrint={() => void printThermalTicketFromSale(selectedAdeudo.sale)}
                    />
                  ) : null
                }
                footer={
                  adeudosTickets.length > 0 && !selectedAdeudo ? (
                    <Button type="button" variant="outline" asChild>
                      <Link to="/cuentas-por-cobrar">Ir a Cuentas por cobrar</Link>
                    </Button>
                  ) : null
                }
              />
            </TabsContent>

            <TabsContent value="credito" className="mt-0 min-h-0 flex-1 overflow-auto max-md:flex-none max-md:overflow-visible">
              <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                  <div>
                    <CardTitle className="text-base">Crédito de tienda</CardTitle>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-500">
                      Saldo a favor del cliente cuando no se puede devolver efectivo (devoluciones, cambios, etc.).
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">
                      {formatMoney(saldoCredito)}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-500">Disponible en POS</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="bg-gradient-to-r from-violet-500 to-purple-600 text-white"
                      onClick={() => {
                        resetCreditoForm();
                        setCreditoDialogOpen(true);
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Otorgar crédito
                    </Button>
                    {saldoCredito > 0.005 ? (
                      <Button type="button" variant="outline" asChild>
                        <Link to="/pos">Usar en punto de venta</Link>
                      </Button>
                    ) : null}
                  </div>

                  {creditoHistorial.length === 0 ? (
                    <EmptyBlock message="Este cliente aún no tiene movimientos de crédito de tienda." />
                  ) : (
                    <ul className="space-y-2">
                      {creditoHistorial.map((entry, idx) => (
                        <li
                          key={`${entry.at.getTime()}-${idx}`}
                          className={cn(
                            'rounded-lg border px-3 py-2.5 text-sm',
                            entry.tipo === 'uso'
                              ? 'border-amber-200/80 bg-amber-500/5 dark:border-amber-900/40'
                              : 'border-violet-200/80 bg-violet-500/5 dark:border-violet-900/40'
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-slate-900 dark:text-slate-100">
                                {labelCreditoTiendaTipo(entry.tipo)}
                                {entry.motivo ? ` · ${labelCreditoTiendaMotivo(entry.motivo)}` : ''}
                              </p>
                              <p className="text-xs text-slate-600 dark:text-slate-500">
                                {formatInAppTimezone(entry.at, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                                {entry.referencia ? ` · Ref. ${entry.referencia}` : ''}
                                {entry.usuarioNombre ? ` · ${entry.usuarioNombre}` : ''}
                              </p>
                              {entry.notas?.trim() ? (
                                <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                                  {entry.notas.trim()}
                                </p>
                              ) : null}
                            </div>
                            <span
                              className={cn(
                                'shrink-0 font-semibold tabular-nums',
                                entry.tipo === 'uso'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-violet-700 dark:text-violet-400'
                              )}
                            >
                              {entry.tipo === 'uso' ? '−' : '+'}
                              {formatMoney(entry.monto)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">
                            Saldo {formatMoney(entry.saldoAnterior)} → {formatMoney(entry.saldoNuevo)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {selectedSale && activeTab === 'resumen' ? (
            <DialogOverlay onClose={() => setSelectedSale(null)}>
              <SaleDetailPanel
                sale={selectedSale}
                onPrint={() => void printThermalTicketFromSale(selectedSale)}
              />
            </DialogOverlay>
          ) : null}
        </div>
      ) : null}

      <Dialog open={creditoDialogOpen} onOpenChange={setCreditoDialogOpen}>
        <DialogContent className="border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Otorgar crédito de tienda</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-slate-600 dark:text-slate-400">
              Cliente: <strong className="text-slate-900 dark:text-slate-100">{client?.nombre}</strong>
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              Saldo actual:{' '}
              <strong className="tabular-nums text-violet-700 dark:text-violet-300">
                {formatMoney(saldoCredito)}
              </strong>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="credito-monto">Monto a acreditar *</Label>
              <Input
                id="credito-monto"
                inputMode="decimal"
                value={creditoMonto}
                onChange={(e) => setCreditoMonto(e.target.value)}
                placeholder="0.00"
                className="border-slate-300 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credito-motivo">Motivo</Label>
              <select
                id="credito-motivo"
                value={creditoMotivo}
                onChange={(e) => setCreditoMotivo(e.target.value as CreditoTiendaMotivoEmisionId)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {CREDITO_TIENDA_MOTIVOS_EMISION.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credito-ref">Referencia (folio ticket, devolución…)</Label>
              <Input
                id="credito-ref"
                value={creditoReferencia}
                onChange={(e) => setCreditoReferencia(e.target.value)}
                placeholder="Opcional"
                className="border-slate-300 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credito-notas">Notas internas</Label>
              <Input
                id="credito-notas"
                value={creditoNotas}
                onChange={(e) => setCreditoNotas(e.target.value)}
                placeholder="Artículos devueltos, condiciones…"
                className="border-slate-300 dark:border-slate-700"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={creditoBusy}
              onClick={() => setCreditoDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={creditoBusy}
              className="bg-gradient-to-r from-violet-500 to-purple-600 text-white"
              onClick={() => void confirmarCreditoTienda()}
            >
              {creditoBusy ? 'Guardando…' : 'Otorgar e imprimir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={abonoCancelEntry != null}
        onOpenChange={(o) => {
          if (!o && !abonoCancelBusy) setAbonoCancelEntry(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este abono?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p>
                  Monto{' '}
                  <span className="font-semibold tabular-nums">
                    {formatMoney(abonoCancelEntry?.monto ?? 0)}
                  </span>
                </p>
                <p>
                  Se restaurará el saldo pendiente, se quitará del corte y los tickets volverán a deber.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={abonoCancelBusy}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={abonoCancelBusy || !effectiveSucursalId || !client}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void (async () => {
                  if (!abonoCancelEntry || !effectiveSucursalId || !client) return;
                  setAbonoCancelBusy(true);
                  try {
                    await anularAbonoCxC({
                      sucursalId: effectiveSucursalId,
                      clienteId: client.id,
                      monto: abonoCancelEntry.monto,
                      formaPago: abonoCancelEntry.formaPago,
                      cajaSesionId: abonoCancelEntry.cajaSesionId,
                      at:
                        abonoCancelEntry.at instanceof Date
                          ? abonoCancelEntry.at
                          : new Date(abonoCancelEntry.at),
                    });
                    addToast({
                      type: 'success',
                      message: `Abono de ${formatMoney(abonoCancelEntry.monto)} anulado.`,
                    });
                    setAbonoCancelEntry(null);
                  } catch (err) {
                    addToast({
                      type: 'error',
                      message: err instanceof Error ? err.message : 'No se pudo anular el abono',
                    });
                  } finally {
                    setAbonoCancelBusy(false);
                  }
                })();
              }}
            >
              {abonoCancelBusy ? 'Anulando…' : 'Confirmar anulación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: 'danger' | 'success';
  onClick?: () => void;
}) {
  const inner = (
    <CardContent className="flex items-center gap-2 px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/80 dark:bg-slate-800/80">
        {icon}
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            'truncate text-sm font-bold tabular-nums',
            highlight === 'danger' && 'text-red-700 dark:text-red-400',
            highlight === 'success' && 'text-emerald-700 dark:text-emerald-400',
            !highlight && 'text-slate-900 dark:text-slate-100'
          )}
        >
          {value}
        </p>
        <p className="truncate text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">{label}</p>
      </div>
    </CardContent>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-slate-200/80 bg-slate-50/90 text-left transition-colors hover:border-brand/40 hover:bg-slate-100 dark:border-slate-800/50 dark:bg-slate-900/50 dark:hover:bg-slate-900/80"
      >
        {inner}
      </button>
    );
  }

  return (
    <Card className="border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50">
      {inner}
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-500">{label}</p>
      <div className="text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}

function SaleListRow({ sale }: { sale: Sale }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
          {saleIsInvoiced(sale) ? (
            <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <FileQuestion className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <span className="truncate">{sale.folio}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-brand dark:text-brand">
          {formatMoney(sale.total)}
        </span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-500">
        {formatInAppTimezone(sale.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
        {saleListaCancelacionEtiqueta(sale) ? ` · ${saleListaCancelacionEtiqueta(sale)}` : ''}
        {sale.estado === 'pendiente' ? ' · Fiado' : ''}
      </p>
    </>
  );
}

function CompactSalesTable({
  sales,
  onSelect,
}: {
  sales: Sale[];
  onSelect: (sale: Sale) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Folio</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sales.map((sale) => (
          <TableRow key={sale.id} className="cursor-pointer" onClick={() => onSelect(sale)}>
            <TableCell>{sale.folio}</TableCell>
            <TableCell>
              {formatInAppTimezone(sale.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(sale.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SaleDetailPanel({ sale, onPrint }: { sale: Sale; onPrint: () => void }) {
  return (
    <div className="space-y-4 text-sm">
      <div
        className={cn(
          'rounded-lg border px-3 py-2.5',
          saleIsInvoiced(sale)
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            : 'border-slate-300/80 bg-slate-200/80 dark:border-slate-600 dark:bg-slate-800/50'
        )}
      >
        <p className="flex items-center gap-2 font-medium">
          {saleIsInvoiced(sale) ? (
            <>
              <BadgeCheck className="h-5 w-5 text-emerald-500" />
              Facturada
            </>
          ) : (
            <>
              <FileQuestion className="h-5 w-5 text-slate-500" />
              Sin facturar
            </>
          )}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Fecha</dt>
          <dd className="font-medium">
            {formatInAppTimezone(sale.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Estado</dt>
          <dd className="font-medium">{saleEstadoEtiqueta(sale)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-600 dark:text-slate-500">Total</dt>
          <dd className="text-lg font-semibold tabular-nums text-brand dark:text-brand">
            {formatMoney(sale.total)}
          </dd>
        </div>
      </dl>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
          Artículos
        </p>
        <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200/80 bg-white/60 p-2.5 text-xs dark:border-slate-700/60 dark:bg-slate-900/40">
          {(sale.productos ?? []).length === 0 ? (
            <li className="text-slate-600 dark:text-slate-500">Sin líneas registradas.</li>
          ) : (
            (sale.productos ?? []).map((item) => (
              <li key={item.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{lineaDescripcion(item)}</span>
                <span className="shrink-0 tabular-nums">
                  ×{item.cantidad} · {formatMoney(Number(item.total) || 0)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      <Button type="button" className="bg-brand-gradient text-white" onClick={onPrint}>
        <Printer className="mr-2 h-4 w-4" />
        Reimprimir ticket
      </Button>
    </div>
  );
}

function AdeudoDetailPanel({ row, onPrint }: { row: AdeudoTicketRow; onPrint: () => void }) {
  const { sale, adeudo } = row;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Fecha</dt>
          <dd className="font-medium">
            {formatInAppTimezone(sale.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Saldo pendiente</dt>
          <dd className="font-semibold tabular-nums text-red-700 dark:text-red-400">
            {formatMoney(adeudo)}
          </dd>
        </div>
      </dl>
      <div className="space-y-1 rounded-lg border border-slate-200/80 bg-slate-200/50 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-800/40">
        <div className="flex justify-between gap-2">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(sale.total)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Pagado</span>
          <span className="tabular-nums">{formatMoney(totalPagadoVenta(sale))}</span>
        </div>
        <div className="flex justify-between gap-2 font-semibold text-red-700 dark:text-red-400">
          <span>Saldo</span>
          <span className="tabular-nums">{formatMoney(adeudo)}</span>
        </div>
      </div>
      <Button type="button" className="bg-brand-gradient text-white" onClick={onPrint}>
        <Printer className="mr-2 h-4 w-4" />
        Reimprimir ticket
      </Button>
    </div>
  );
}

function EntityListPanel<T>({
  title,
  loading,
  list,
  detail,
  selected,
  onBack,
  selectedTitle,
  headerExtra,
  footer,
  backLabel,
}: {
  title: string;
  loading: boolean;
  list: React.ReactNode;
  detail: React.ReactNode;
  selected: T | null;
  onBack: () => void;
  selectedTitle?: string;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  backLabel: string;
}) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 bg-slate-50/90 dark:border-slate-800/50 dark:bg-slate-900/50 max-md:flex-none max-md:overflow-visible">
      <CardHeader className="shrink-0 border-b border-slate-200/80 pb-3 dark:border-slate-800/60">
        {selected ? (
          <div className="flex items-start gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <CardTitle className="text-base">{selectedTitle ?? title}</CardTitle>
              <p className="text-xs text-slate-600 dark:text-slate-500">{backLabel}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            {headerExtra}
          </div>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 max-md:overflow-visible">
        {loading ? (
          <LoadingBlock />
        ) : selected ? (
          detail
        ) : (
          <>
            {list}
            {footer ? <div className="mt-4">{footer}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingBlock({ message = 'Cargando…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-600 dark:text-slate-500">
      <Loader2 className="h-8 w-8 animate-spin text-brand" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300/80 py-12 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-500">
      {message}
    </div>
  );
}

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}
