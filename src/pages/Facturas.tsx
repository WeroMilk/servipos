import { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Download,
  Send,
  X,
  Check,
  AlertTriangle,
  Receipt,
  MoreHorizontal,
  FileCode,
  Eye,
  Printer,
  Trash2,
} from 'lucide-react';
import { normalizeClaveProdServ, normalizeClaveUnidadSat } from '@/lib/satCatalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useInvoices, useCFDIGenerator, useSales, useFiscalConfig, useClients, useEffectiveSucursalId } from '@/hooks';
import { useAppStore } from '@/stores';
import type { Invoice, Sale, Client } from '@/types';
import { FORMAS_PAGO_UI, USOS_CFDI } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageShell } from '@/components/ui-custom/PageShell';
import { SendEmailDialog } from '@/components/ui-custom/SendEmailDialog';
import { AVISO_DOC_FISCAL_PRUEBA } from '@/lib/printTicket';
import { printInvoiceCfdiRepresentacion } from '@/lib/cfdiRepresentacionImpresa';
import { exportInvoiceCfdiToPdf } from '@/lib/invoicePdfExport';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { getInvoiceById } from '@/db/database';
import { getInvoiceFirestore } from '@/lib/firestore/invoicesFirestore';

const statusColors: Record<string, string> = {
  pendiente: 'bg-amber-500/10 text-black border-amber-500/30 dark:text-amber-100',
  enviada: 'bg-sky-500/10 text-sky-800 border-sky-500/30 dark:text-sky-200',
  timbrada: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  cancelada: 'bg-red-500/10 text-red-400 border-red-500/30',
  error: 'bg-red-500/10 text-red-400 border-red-500/30',
};

const statusLabels: Record<string, string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  timbrada: 'Timbrada',
  cancelada: 'Cancelada',
  error: 'Error',
};

/** Parseo laxo de monto en búsqueda (coma/punto decimal). */
function parseMoneyQuery(raw: string): number | null {
  const t = raw.trim().replace(/\$/g, '').replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Filtra ventas facturables según folio (incl. últimos 4 dígitos), total o nombre de cliente. */
function saleMatchesInvoicePickerQuery(sale: Sale, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const ql = q.toLowerCase();
  const folio = String(sale.folio ?? '');
  if (folio.toLowerCase().includes(ql)) return true;

  const nombre = (sale.cliente?.nombre || 'Mostrador').toLowerCase();
  if (nombre.includes(ql)) return true;

  const folioDigits = folio.replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');
  if (qDigits.length >= 1 && folioDigits.length > 0) {
    if (folioDigits.endsWith(qDigits)) return true;
    if (qDigits.length >= 4 && folioDigits.includes(qDigits)) return true;
  }

  const total = Number(sale.total) || 0;
  const qNum = parseMoneyQuery(q);
  if (qNum != null && Math.abs(qNum - total) < 0.02) return true;

  const moneyFmt = formatMoney(total).toLowerCase().replace(/\s/g, '');
  if (moneyFmt.includes(ql.replace(/\s/g, ''))) return true;

  return false;
}

export function Facturas() {
  const { invoices, loading, addInvoice, cancelInvoice, removeInvoice, markInvoiceEnviada } =
    useInvoices();
  const { sales } = useSales(100);
  const { clients } = useClients();
  const { config: fiscalConfig } = useFiscalConfig();
  const { generateXML } = useCFDIGenerator();
  const { addToast } = useAppStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showXMLDialog, setShowXMLDialog] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [generatedXML, setGeneratedXML] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTargetInvoiceId, setEmailTargetInvoiceId] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<Invoice | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState(false);

  const handleDeleteInvoice = (inv: Invoice) => {
    setDeleteInvoiceTarget(inv);
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteInvoiceTarget) return;
    setDeletingInvoice(true);
    try {
      await removeInvoice(deleteInvoiceTarget.id);
      addToast({ type: 'success', message: 'Factura eliminada del historial local', logToAppEvents: true });
      setDeleteInvoiceTarget(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar',
        logToAppEvents: true,
      });
    } finally {
      setDeletingInvoice(false);
    }
  };

  // Form state
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({
    formaPago: '01',
    metodoPago: 'PUE',
    usoCfdi: 'G03',
  });
  const [salePickerQuery, setSalePickerQuery] = useState('');
  /** Tras crear la factura, abre el diálogo de impresión (representación impresa CFDI). */
  const [printAfterCreate, setPrintAfterCreate] = useState(true);

  const handleGenerateInvoice = async () => {
    if (!selectedSale) {
      addToast({ type: 'error', message: 'Seleccione una venta' });
      return;
    }

    if (!fiscalConfig) {
      addToast({ type: 'error', message: 'Configure los datos fiscales primero' });
      return;
    }

    try {
      const client = selectedClient || selectedSale.cliente;
      
      const invoiceData = {
        clienteId: client?.id || 'mostrador',
        cliente: client,
        emisor: fiscalConfig,
        ventaId: selectedSale.id,
        productos: (selectedSale.productos ?? []).map((item) => {
          const cps = normalizeClaveProdServ(item.producto?.claveProdServ);
          return {
          id: crypto.randomUUID(),
          productId: item.productId,
          claveProdServ: cps.length === 8 ? cps : '01010101',
          claveUnidad: normalizeClaveUnidadSat(item.producto?.unidadMedida),
          cantidad: item.cantidad,
          descripcion: item.producto?.nombre?.trim() || item.productoNombre?.trim() || '',
          precioUnitario: item.precioUnitario,
          descuento: item.descuento,
          impuestosTrasladados: [{
            tipo: 'Traslado' as const,
            impuesto: '002' as const,
            tipoFactor: 'Tasa' as const,
            tasaOCuota: 0.16,
            base: item.subtotal - item.descuento,
            importe: (item.subtotal - item.descuento) * 0.16,
          }],
          impuestosRetenidos: [],
          subtotal: item.subtotal,
          total: item.total,
        };
        }),
        subtotal: selectedSale.subtotal,
        descuento: selectedSale.descuento,
        impuestosTrasladados: selectedSale.impuestos,
        impuestosRetenidos: 0,
        total: selectedSale.total,
        formaPago: formData.formaPago as any,
        metodoPago: formData.metodoPago as any,
        lugarExpedicion: fiscalConfig.lugarExpedicion,
        fechaEmision: new Date(),
        estado: 'pendiente' as const,
      };

      const newId = await addInvoice(invoiceData as any);

      setShowAddDialog(false);
      resetForm();
      addToast({
        type: 'success',
        message: fiscalConfig.modoPruebaFiscal
          ? 'Factura de prueba creada (serie PRUEBA, sin validez fiscal)'
          : 'Factura generada exitosamente',
        logToAppEvents: true,
      });

      if (printAfterCreate) {
        const created = effectiveSucursalId
          ? await getInvoiceFirestore(effectiveSucursalId, newId)
          : await getInvoiceById(newId);
        if (created?.emisor?.rfc) {
          printInvoiceCfdiRepresentacion(created);
          void markInvoiceEnviada(newId).then(() => {
            setSelectedInvoice((prev) =>
              prev?.id === newId ? { ...prev, estado: 'enviada' } : prev
            );
          });
        } else if (created) {
          addToast({
            type: 'error',
            message: 'Factura guardada pero faltan datos del emisor para imprimir. Use Imprimir en el menú de la factura.',
            logToAppEvents: true,
          });
        } else {
          addToast({
            type: 'error',
            message:
              'Factura creada; no se pudo cargar para imprimir de inmediato. Use «Imprimir representación» en la lista.',
            logToAppEvents: true,
          });
        }
      }
    } catch (error: any) {
      addToast({ type: 'error', message: error.message, logToAppEvents: true });
    }
  };

  const handleViewXML = async (invoice: Invoice) => {
    try {
      const xml = await generateXML(invoice);
      setGeneratedXML(xml);
      setSelectedInvoice(invoice);
      setShowXMLDialog(true);
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleDownloadXML = () => {
    const blob = new Blob([generatedXML], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CFDI_${selectedInvoice?.serie}_${selectedInvoice?.folio}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGeneratePDF = async (invoice: Invoice) => {
    if (!invoice.emisor?.rfc) {
      addToast({ type: 'error', message: 'La factura no tiene datos del emisor' });
      return;
    }
    try {
      await exportInvoiceCfdiToPdf(invoice, `Factura_${invoice.serie}_${invoice.folio}`);
      addToast({ type: 'success', message: 'PDF descargado (formato factura clásica)', logToAppEvents: true });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo generar el PDF',
        logToAppEvents: true,
      });
    }
  };

  const resetForm = () => {
    setSelectedSale(null);
    setSelectedClient(null);
    setSalePickerQuery('');
    setFormData({
      formaPago: '01',
      metodoPago: 'PUE',
      usoCfdi: 'G03',
    });
  };

  function buildInvoiceEmailBody(inv: Invoice): string {
    return [
      'SERVIPARTZ POS — Factura',
      '',
      `${inv.serie}-${inv.folio}`,
      `Fecha: ${formatInAppTimezone(inv.fechaEmision, { dateStyle: 'medium', timeStyle: 'short' })}`,
      `Cliente: ${inv.cliente?.nombre ?? 'Público en General'}`,
      `Total: ${formatMoney(inv.total)}`,
      inv.uuid ? `UUID: ${inv.uuid}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const openEmailForInvoice = (inv: Invoice) => {
    setEmailTargetInvoiceId(inv.id);
    setEmailSubject(`Factura ${inv.serie}-${inv.folio} — SERVIPARTZ POS`);
    setEmailBody(buildInvoiceEmailBody(inv));
    setEmailOpen(true);
  };

  const handlePrintRepresentacion = (inv: Invoice) => {
    printInvoiceCfdiRepresentacion(inv);
    void markInvoiceEnviada(inv.id).then(() => {
      setSelectedInvoice((prev) =>
        prev?.id === inv.id ? { ...prev, estado: 'enviada' } : prev
      );
    });
  };

  const searchLc = searchQuery.toLowerCase();
  const filteredInvoices = invoices.filter((i) => {
    const folio = String(i.folio ?? '').toLowerCase();
    const serie = String(i.serie ?? '').toLowerCase();
    const nombreCliente = String(i.cliente?.nombre ?? '').toLowerCase();
    return (
      folio.includes(searchLc) || serie.includes(searchLc) || nombreCliente.includes(searchLc)
    );
  });

  // Filtrar ventas que no tienen factura
  const salesWithoutInvoice = useMemo(
    () => sales.filter((s) => !s.facturaId && s.estado === 'completada'),
    [sales]
  );

  const filteredSalesForPicker = useMemo(
    () => salesWithoutInvoice.filter((s) => saleMatchesInvoicePickerQuery(s, salePickerQuery)),
    [salesWithoutInvoice, salePickerQuery]
  );

  useEffect(() => {
    if (showAddDialog) setSalePickerQuery('');
  }, [showAddDialog]);

  return (
    <>
    <PageShell
      title="Facturación CFDI 4.0"
      subtitle={
        fiscalConfig?.modoPruebaFiscal
          ? 'Modo prueba — no consume folios SAT; desactívalo en Configuración para usar serie y folio oficiales'
          : 'Facturas electrónicas'
      }
      className="min-w-0 max-w-none"
      actionsClassName="md:mt-2"
      actions={
        <Button
          onClick={() => setShowAddDialog(true)}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          size="sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nueva
        </Button>
      }
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
      {fiscalConfig?.modoPruebaFiscal ? (
        <div className="shrink-0 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 sm:px-3">
          <p className="text-[11px] leading-snug text-black sm:text-xs dark:text-amber-50">
            <span className="font-semibold text-black dark:text-amber-50">Modo prueba activo.</span>{' '}
            Las facturas nuevas usan serie PRUEBA y no avanzan el folio oficial. Para producción: desactiva el modo en
            Configuración → Datos fiscales, ingresa serie y folio autorizados y usa el timbrado con tu PAC; el XML
            previo sin timbre no tiene validez ante el SAT.
          </p>
        </div>
      ) : null}
      <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
      {fiscalConfig ? (
        <Card className="shrink-0 border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 lg:min-w-0 lg:max-w-md lg:flex-[0_1_340px]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-2 sm:p-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 sm:h-10 sm:w-10">
                <Receipt className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">
                  {fiscalConfig.modoPruebaFiscal ? 'Siguiente folio (prueba)' : 'Siguiente folio'}
                </p>
                <p className="text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg">
                  {fiscalConfig.modoPruebaFiscal
                    ? `PRUEBA - ${fiscalConfig.folioPruebaFactura ?? 1}`
                    : `${fiscalConfig.serie} - ${fiscalConfig.folioActual}`}
                </p>
              </div>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">RFC emisor</p>
              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-base">{fiscalConfig.rfc}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Folio, serie o cliente..."
          className="h-9 w-full border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 pl-9 text-sm text-slate-900 dark:text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>
      </div>

      <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
        <CardHeader className="shrink-0 space-y-0 py-2">
          <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">Emitidas</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div className="space-y-2 p-2 md:hidden">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <p className="py-8 text-center text-slate-600 dark:text-slate-500">No se encontraron facturas</p>
            ) : (
              filteredInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInvoice(invoice);
                      setShowDetailDialog(true);
                    }}
                    className="min-w-0 flex-1 rounded-lg p-2 text-left transition-colors hover:bg-slate-100/90 dark:bg-slate-900/60"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {invoice.serie}-{invoice.folio}
                      </span>
                      {invoice.esPrueba ? (
                        <Badge className="border border-amber-500/40 bg-amber-500/15 text-[10px] text-black dark:text-amber-100">
                          Prueba
                        </Badge>
                      ) : null}
                      <span className="shrink-0 text-cyan-400">{formatMoney(invoice.total)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-400">
                      {invoice.cliente?.nombre || 'Mostrador'}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-600 dark:text-slate-500">
                        {new Date(invoice.fechaEmision).toLocaleDateString('es-MX')}
                      </span>
                      <Badge
                        className={cn(
                          'border text-[10px]',
                          statusColors[invoice.estado] ?? statusColors.error
                        )}
                      >
                        {statusLabels[invoice.estado] ?? invoice.estado}
                      </Badge>
                    </div>
                    <p className="mt-2 text-center text-xs text-cyan-500/80">Ver detalle…</p>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 self-start text-slate-600 dark:text-slate-500 hover:text-red-400 disabled:opacity-30"
                    disabled={invoice.estado === 'timbrada'}
                    title={
                      invoice.estado === 'timbrada'
                        ? 'No se puede eliminar una factura timbrada'
                        : 'Eliminar del historial'
                    }
                    aria-label="Eliminar factura"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteInvoice(invoice);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="hidden min-h-0 min-w-0 md:block">
            <div className="min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800">
                  <TableHead className="text-slate-600 dark:text-slate-400">Folio</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Cliente</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Fecha</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Total</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Estado</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
                    </TableCell>
                  </TableRow>
                ) : filteredInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-600 dark:text-slate-500">
                      No se encontraron facturas
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id} className="border-slate-200/80 dark:border-slate-800/50">
                      <TableCell className="align-top">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-800 dark:text-slate-200">
                              {invoice.serie}-{invoice.folio}
                            </p>
                            {invoice.esPrueba ? (
                              <Badge className="border border-amber-500/40 bg-amber-500/15 text-[10px] text-black dark:text-amber-100">
                                Prueba
                              </Badge>
                            ) : null}
                          </div>
                          {invoice.uuid ? (
                            <p className="truncate text-xs text-slate-600 dark:text-slate-500">
                              UUID: {invoice.uuid.slice(0, 8)}…
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-slate-600 dark:text-slate-400">
                        {invoice.cliente?.nombre || 'Mostrador'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {new Date(invoice.fechaEmision).toLocaleDateString('es-MX')}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium text-cyan-400">
                        {formatMoney(invoice.total)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            'border',
                            statusColors[invoice.estado] ?? statusColors.error
                          )}
                        >
                          {statusLabels[invoice.estado] ?? invoice.estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-slate-600 dark:text-slate-400">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedInvoice(invoice);
                                setShowDetailDialog(true);
                              }}
                              className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Ver Detalle
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleViewXML(invoice)}
                              className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                            >
                              <FileCode className="mr-2 h-4 w-4" />
                              Ver XML
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void handleGeneratePDF(invoice)}
                              className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Descargar PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handlePrintRepresentacion(invoice)}
                              className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                            >
                              <Printer className="mr-2 h-4 w-4" />
                              Imprimir (carta)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openEmailForInvoice(invoice)}
                              className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                            >
                              <Send className="mr-2 h-4 w-4" />
                              Enviar por Email
                            </DropdownMenuItem>
                            {invoice.estado !== 'cancelada' && (
                              <DropdownMenuItem
                                onClick={() => cancelInvoice(invoice.id, 'Error en datos')}
                                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                              >
                                <X className="mr-2 h-4 w-4" />
                                Cancelar
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              disabled={invoice.estado === 'timbrada'}
                              onClick={() => void handleDeleteInvoice(invoice)}
                              className="text-red-400 hover:bg-red-500/10 hover:text-red-300 data-[disabled]:opacity-40"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Eliminar del historial
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </PageShell>

      {/* Add Invoice Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-h-[92dvh] overflow-y-auto md:max-w-[min(92vw,56rem)] lg:max-w-[min(92vw,64rem)]">
          <DialogHeader>
            <DialogTitle>Generar Nueva Factura</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {!fiscalConfig ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-black dark:text-amber-50">
                <p className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-800 dark:text-amber-300" />
                  Configure los datos fiscales antes de generar facturas
                </p>
              </div>
            ) : (
              <>
                {fiscalConfig.modoPruebaFiscal ? (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-black dark:text-amber-50">
                    Se emitirá una factura de prueba con serie <strong className="text-black dark:text-amber-50">PRUEBA</strong> (no se
                    usa tu folio oficial). Úsala para revisar impresión y XML; la validez ante el SAT requiere timbrado
                    con PAC y folios autorizados.
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label>Seleccionar venta *</Label>
                  <p className="text-[11px] text-slate-600 dark:text-slate-500">
                    Escriba los últimos dígitos del folio, el monto o el nombre del cliente para acotar la lista.
                  </p>
                  <Input
                    value={salePickerQuery}
                    onChange={(e) => setSalePickerQuery(e.target.value)}
                    placeholder="Ej. 0007, 1500.50 o Juan Pérez…"
                    className="h-10 w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <div className="max-h-52 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200/60 dark:bg-slate-800/60">
                    {filteredSalesForPicker.length === 0 ? (
                      <p className="px-3 py-3 text-center text-sm text-slate-600 dark:text-slate-500">
                        {salesWithoutInvoice.length === 0
                          ? 'No hay ventas completadas sin factura.'
                          : 'Ninguna venta coincide con la búsqueda.'}
                      </p>
                    ) : (
                      filteredSalesForPicker.map((sale) => (
                        <button
                          key={sale.id}
                          type="button"
                          onClick={() => setSelectedSale(sale)}
                          className={cn(
                            'flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-slate-300/80 px-3 py-2.5 text-left text-sm last:border-b-0 dark:border-slate-700/80',
                            'hover:bg-slate-300/50 dark:hover:bg-slate-700/50',
                            selectedSale?.id === sale.id &&
                              'bg-cyan-500/15 ring-1 ring-inset ring-cyan-500/40 dark:bg-cyan-500/10'
                          )}
                        >
                          <span className="min-w-0 font-mono text-slate-900 dark:text-slate-100">{sale.folio}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">
                            {sale.cliente?.nombre || 'Mostrador'}
                          </span>
                          <span className="shrink-0 font-medium text-cyan-600 dark:text-cyan-400">
                            {formatMoney(sale.total)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  {selectedSale ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span>
                        Seleccionada: <strong className="text-slate-800 dark:text-slate-200">{selectedSale.folio}</strong>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-600 dark:text-slate-500"
                        onClick={() => setSelectedSale(null)}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Quitar
                      </Button>
                    </div>
                  ) : null}
                </div>

                {selectedSale && (
                  <>
                    <div className="space-y-2">
                      <Label>Cliente (opcional, para cambiar)</Label>
                      <select
                        value={selectedClient?.id || ''}
                        onChange={(e) => {
                          const client = clients.find(c => c.id === e.target.value);
                          setSelectedClient(client || null);
                        }}
                        className="w-full h-10 px-3 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Usar cliente de la venta</option>
                        {clients.filter(c => !c.isMostrador).map(client => (
                          <option key={client.id} value={client.id}>
                            {client.nombre} {client.rfc ? `(${client.rfc})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Forma de Pago</Label>
                        <select
                          value={formData.formaPago}
                          onChange={(e) => setFormData({ ...formData, formaPago: e.target.value })}
                          className="w-full h-10 px-3 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          {FORMAS_PAGO_UI.map(fp => (
                            <option key={fp.clave} value={fp.clave}>{fp.descripcion}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label>Método de Pago</Label>
                        <select
                          value={formData.metodoPago}
                          onChange={(e) => setFormData({ ...formData, metodoPago: e.target.value })}
                          className="w-full h-10 px-3 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          <option value="PUE">Pago en una sola exhibición</option>
                          <option value="PPD">Pago en parcialidades</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Uso CFDI</Label>
                      <select
                        value={formData.usoCfdi}
                        onChange={(e) => setFormData({ ...formData, usoCfdi: e.target.value })}
                        className="w-full h-10 px-3 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      >
                        {USOS_CFDI.map(uso => (
                          <option key={uso.clave} value={uso.clave}>{uso.clave} - {uso.descripcion}</option>
                        ))}
                      </select>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300/80 bg-slate-200/40 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <input
                        type="checkbox"
                        checked={printAfterCreate}
                        onChange={(e) => setPrintAfterCreate(e.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400 accent-blue-600 focus:ring-blue-500/40"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          Imprimir representación al crear
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-500">
                          Abre la ventana de impresión en cuanto se genere la factura (mismo formato que «Imprimir
                          representación» en la lista).
                        </span>
                      </span>
                    </label>

                    {/* Resumen de la venta */}
                    <div className="p-4 rounded-lg bg-slate-200/80 dark:bg-slate-800/50 space-y-2">
                      <p className="text-sm text-slate-600 dark:text-slate-400">Resumen de la Venta</p>
                      <div className="flex justify-between text-slate-700 dark:text-slate-300">
                        <span>Subtotal:</span>
                        <span>{formatMoney(selectedSale.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-slate-700 dark:text-slate-300">
                        <span>IVA:</span>
                        <span>{formatMoney(selectedSale.impuestos)}</span>
                      </div>
                      <div className="flex justify-between text-xl font-bold text-cyan-400">
                        <span>Total:</span>
                        <span>{formatMoney(selectedSale.total)}</span>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400">
              Cancelar
            </Button>
            <Button 
              onClick={handleGenerateInvoice}
              disabled={!selectedSale || !fiscalConfig}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Generar Factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* XML Viewer Dialog */}
      <Dialog open={showXMLDialog} onOpenChange={setShowXMLDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-h-[92dvh] overflow-y-auto md:max-w-[min(92vw,72rem)] lg:max-w-[min(92vw,80rem)]">
          <DialogHeader>
            <DialogTitle>XML CFDI 4.0</DialogTitle>
            {selectedInvoice?.esPrueba ? (
              <p className="text-xs font-normal text-amber-600 dark:text-amber-400">{AVISO_DOC_FISCAL_PRUEBA}</p>
            ) : null}
          </DialogHeader>
          
          <div className="py-4">
            <pre className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 overflow-auto max-h-96">
              {generatedXML}
            </pre>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowXMLDialog(false)} className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400">
              Cerrar
            </Button>
            <Button 
              onClick={handleDownloadXML}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              <Download className="w-4 h-4 mr-2" />
              Descargar XML
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-h-[92dvh] overflow-y-auto md:max-w-[min(92vw,56rem)] lg:max-w-[min(92vw,64rem)]">
          <DialogHeader>
            <DialogTitle>Factura {selectedInvoice?.serie}-{selectedInvoice?.folio}</DialogTitle>
            {selectedInvoice?.esPrueba ? (
              <p className="text-xs font-normal text-amber-600 dark:text-amber-400">{AVISO_DOC_FISCAL_PRUEBA}</p>
            ) : null}
          </DialogHeader>
          
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Emisor</p>
                  <p className="text-slate-800 dark:text-slate-200">{selectedInvoice.emisor.razonSocial}</p>
                  <p className="text-slate-600 dark:text-slate-400">{selectedInvoice.emisor.rfc}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-600 dark:text-slate-500">Fecha de Emisión</p>
                  <p className="text-slate-800 dark:text-slate-200">
                    {new Date(selectedInvoice.fechaEmision).toLocaleString('es-MX')}
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                <p className="text-slate-600 dark:text-slate-500 text-sm mb-2">Receptor</p>
                <p className="text-slate-800 dark:text-slate-200">{selectedInvoice.cliente?.nombre || 'Público en General'}</p>
                <p className="text-slate-600 dark:text-slate-400">{selectedInvoice.cliente?.rfc || 'XAXX010101000'}</p>
              </div>

              <div
                data-wheel-scroll-x="table"
                className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"
              >
                <table className="w-full min-w-[20rem]">
                  <thead className="bg-slate-200/80 dark:bg-slate-800/50">
                    <tr>
                      <th className="text-left p-3 text-sm text-slate-600 dark:text-slate-400">Descripción</th>
                      <th className="text-center p-3 text-sm text-slate-600 dark:text-slate-400">Cant.</th>
                      <th className="text-right p-3 text-sm text-slate-600 dark:text-slate-400">P.Unit</th>
                      <th className="text-right p-3 text-sm text-slate-600 dark:text-slate-400">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50">
                    {selectedInvoice.productos.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-3 text-slate-800 dark:text-slate-200">{item.descripcion}</td>
                        <td className="p-3 text-center text-slate-600 dark:text-slate-400">{item.cantidad}</td>
                        <td className="p-3 text-right text-slate-600 dark:text-slate-400">{formatMoney(item.precioUnitario)}</td>
                        <td className="p-3 text-right text-cyan-400">{formatMoney(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end space-y-1">
                <div className="text-right">
                  <p className="text-slate-600 dark:text-slate-400">Subtotal: {formatMoney(selectedInvoice.subtotal)}</p>
                  <p className="text-slate-600 dark:text-slate-400">Descuento: {formatMoney(selectedInvoice.descuento)}</p>
                  <p className="text-slate-600 dark:text-slate-400">IVA: {formatMoney(selectedInvoice.impuestosTrasladados)}</p>
                  <p className="mt-2 text-xl font-bold text-cyan-400">
                    Total: {formatMoney(selectedInvoice.total)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  onClick={() => handlePrintRepresentacion(selectedInvoice)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir (carta)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  onClick={() => openEmailForInvoice(selectedInvoice)}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Enviar por email
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteInvoiceTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteInvoiceTarget(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar factura del historial?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              {deleteInvoiceTarget
                ? `Factura ${deleteInvoiceTarget.serie}-${deleteInvoiceTarget.folio}. Solo se permite si no está timbrada.`
                : 'Solo se permite si no está timbrada.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingInvoice}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingInvoice}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteInvoice();
              }}
            >
              {deletingInvoice ? 'Eliminando…' : 'Sí, eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendEmailDialog
        open={emailOpen}
        onOpenChange={(open) => {
          setEmailOpen(open);
          if (!open) setEmailTargetInvoiceId(null);
        }}
        subject={emailSubject}
        body={emailBody}
        title="Enviar factura por correo"
        onAfterSend={() => {
          const id = emailTargetInvoiceId;
          if (!id) return;
          void markInvoiceEnviada(id).then(() => {
            setSelectedInvoice((prev) =>
              prev?.id === id ? { ...prev, estado: 'enviada' } : prev
            );
          });
        }}
      />
    </>
  );
}
