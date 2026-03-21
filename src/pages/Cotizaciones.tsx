import { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  ShoppingCart,
  Check,
  X,
  MoreHorizontal,
  Send,
  FileText,
  Printer,
  Trash2,
} from 'lucide-react';
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
import { useQuotations, useProducts, useClients, useEffectiveSucursalId } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Quotation, Product } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageShell } from '@/components/ui-custom/PageShell';
import { SendEmailDialog } from '@/components/ui-custom/SendEmailDialog';
import { printLetterDocument } from '@/lib/printTicket';
import { formatInAppTimezone } from '@/lib/appTimezone';

const statusColors: Record<string, string> = {
  pendiente: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  aceptada: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  rechazada: 'bg-red-500/10 text-red-400 border-red-500/30',
  vencida: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
  convertida:
    'bg-cyan-500/10 text-cyan-800 border-cyan-500/30 dark:text-cyan-400',
};

const statusLabels: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  convertida: 'Convertida',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cajeroNombreFromUser(u: { name?: string; username?: string; email?: string } | null | undefined): string {
  if (!u) return '';
  return (u.name?.trim() || u.username?.trim() || u.email?.trim() || '').trim();
}

function buildQuotationEmailBody(q: Quotation): string {
  const lines = [
    'SERVIPARTZ POS — Cotización',
    '',
    `Folio: ${q.folio}`,
    `Cliente: ${q.cliente?.nombre ?? 'Mostrador'}`,
    `Fecha: ${formatInAppTimezone(q.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}`,
    q.usuarioNombre?.trim() ? `Cajero: ${q.usuarioNombre.trim()}` : '',
    `Vigencia: ${formatInAppTimezone(q.fechaVigencia, { dateStyle: 'medium' })}`,
    `Estado: ${statusLabels[q.estado] ?? q.estado}`,
    '',
    'Detalle:',
    ...q.productos.map(
      (it, i) =>
        `${i + 1}. ${it.producto?.nombre ?? 'Producto'}  x${it.cantidad}  ${formatMoney(it.total)}`
    ),
    '',
    `Subtotal: ${formatMoney(q.subtotal)}`,
    `Impuestos: ${formatMoney(q.impuestos)}`,
    `Total: ${formatMoney(q.total)}`,
    q.notas ? `\nNotas: ${q.notas}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function printQuotationLetter(q: Quotation, fallbackSucursalId?: string | null): void {
  const rows = q.productos
    .map(
      (it) =>
        `<tr><td>${esc(it.producto?.nombre ?? '')}</td><td class="right">${it.cantidad}</td><td class="right">${formatMoney(it.precioUnitario)}</td><td class="right">${formatMoney(it.total)}</td></tr>`
    )
    .join('');
  const html = `
    <p><strong>Cliente:</strong> ${esc(q.cliente?.nombre ?? 'Mostrador')}</p>
    <p><strong>Fecha:</strong> ${esc(formatInAppTimezone(q.createdAt, { dateStyle: 'medium', timeStyle: 'short' }))}</p>
    <p><strong>Cajero:</strong> ${esc(q.usuarioNombre?.trim() || '—')}</p>
    <p><strong>Vigencia:</strong> ${esc(formatInAppTimezone(q.fechaVigencia, { dateStyle: 'medium' }))}</p>
    <table>
      <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">P. unit.</th><th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="tot">
      <p>Subtotal: ${formatMoney(q.subtotal)}</p>
      <p>Impuestos: ${formatMoney(q.impuestos)}</p>
      <p><strong>Total: ${formatMoney(q.total)}</strong></p>
    </div>
  `;
  printLetterDocument(`Cotización ${q.folio}`, html, {
    sucursalId: q.sucursalId ?? fallbackSucursalId ?? null,
  });
}

export function Cotizaciones() {
  const { quotations, loading, addQuotation, convertToSale, removeQuotation } = useQuotations();
  const { products } = useProducts();
  const { clients } = useClients();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { user } = useAuthStore();
  const { addToast } = useAppStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const [quotationItems, setQuotationItems] = useState<
    { product: Product; quantity: number; discount: number }[]
  >([]);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [vigenciaDias, setVigenciaDias] = useState(7);
  const [vigenciaFocus, setVigenciaFocus] = useState(false);
  const [notas, setNotas] = useState('');

  const filteredProducts = useMemo(() => {
    const q = productSearchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.codigoBarras && p.codigoBarras.toLowerCase().includes(q))
    );
  }, [products, productSearchQuery]);

  const handleDeleteQuotation = async (q: Quotation) => {
    const ok = window.confirm(
      `¿Eliminar la cotización ${q.folio}? Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    try {
      await removeQuotation(q.id);
      addToast({ type: 'success', message: 'Cotización eliminada' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar',
      });
    }
  };

  const openEmailForQuotation = (q: Quotation) => {
    setEmailSubject(`Cotización ${q.folio} — SERVIPARTZ POS`);
    setEmailBody(buildQuotationEmailBody(q));
    setEmailOpen(true);
  };

  const handleAddItem = (product: Product) => {
    const existing = quotationItems.find((item) => item.product.id === product.id);
    if (existing) {
      setQuotationItems((items) =>
        items.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      );
    } else {
      setQuotationItems([...quotationItems, { product, quantity: 1, discount: 0 }]);
    }
  };

  const handleRemoveItem = (productId: string) => {
    setQuotationItems((items) => items.filter((item) => item.product.id !== productId));
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }
    setQuotationItems((items) =>
      items.map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    );
  };

  const calculateTotals = () => {
    const subtotal = quotationItems.reduce((sum, item) => {
      const itemSubtotal = item.product.precioVenta * item.quantity;
      const itemDiscount = itemSubtotal * (item.discount / 100);
      return sum + (itemSubtotal - itemDiscount);
    }, 0);

    const impuestos = subtotal * 0.16;
    const total = subtotal + impuestos;

    return { subtotal, impuestos, total };
  };

  const handleSaveQuotation = async () => {
    if (quotationItems.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos a la cotización' });
      return;
    }

    try {
      const { subtotal, impuestos, total } = calculateTotals();

      await addQuotation({
        clienteId: selectedClient || 'mostrador',
        productos: quotationItems.map((item) => ({
          id: crypto.randomUUID(),
          productId: item.product.id,
          cantidad: item.quantity,
          precioUnitario: item.product.precioVenta,
          descuento: item.discount,
          impuesto: item.product.impuesto,
          subtotal: item.product.precioVenta * item.quantity * (1 - item.discount / 100),
          total:
            item.product.precioVenta *
            item.quantity *
            (1 - item.discount / 100) *
            (1 + item.product.impuesto / 100),
        })),
        subtotal,
        descuento: 0,
        impuestos,
        total,
        vigenciaDias,
        fechaVigencia: new Date(Date.now() + vigenciaDias * 24 * 60 * 60 * 1000),
        estado: 'pendiente',
        notas,
        usuarioId: user?.id || 'system',
        usuarioNombre: cajeroNombreFromUser(user) || undefined,
      } as any);

      setShowAddDialog(false);
      resetForm();
      addToast({ type: 'success', message: 'Cotización creada exitosamente' });
    } catch (error: unknown) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'Error' });
    }
  };

  const handleConvertToSale = async (quotation: Quotation) => {
    try {
      await convertToSale(quotation.id, user?.id || 'system', cajeroNombreFromUser(user) || undefined);
      addToast({ type: 'success', message: 'Cotización convertida a venta' });
    } catch (error: unknown) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'Error' });
    }
  };

  const resetForm = () => {
    setQuotationItems([]);
    setSelectedClient('');
    setVigenciaDias(7);
    setNotas('');
    setProductSearchQuery('');
  };

  const filteredQuotations = quotations.filter(
    (q) =>
      q.folio.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.cliente?.nombre.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openDetail = (q: Quotation) => {
    setSelectedQuotation(q);
    setShowDetailDialog(true);
  };

  return (
    <>
      <PageShell
        title="Cotizaciones"
        subtitle="Presupuestos"
        className="min-w-0 max-w-none"
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
          <div className="relative w-full min-w-0 shrink-0">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Folio o cliente..."
              className="h-9 w-full border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 pl-9 text-sm text-slate-900 dark:text-slate-100 sm:h-10 sm:pl-10"
            />
          </div>

          <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 py-2">
              <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">Lista</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto p-0">
              {/* Móvil: tarjetas */}
              <div className="space-y-2 p-2 md:hidden">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
                  </div>
                ) : filteredQuotations.length === 0 ? (
                  <p className="py-8 text-center text-slate-600 dark:text-slate-500">No se encontraron cotizaciones</p>
                ) : (
                  filteredQuotations.map((q) => (
                    <div
                      key={q.id}
                      className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-1 transition-colors hover:border-slate-300 dark:border-slate-700"
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(q)}
                        className="min-w-0 flex-1 rounded-lg p-2 text-left transition-colors hover:bg-slate-100/90 dark:bg-slate-900/60"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">{q.folio}</p>
                          <span className="shrink-0 text-sm font-semibold text-cyan-400">
                            {formatMoney(q.total)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-400">
                          {q.cliente?.nombre ?? 'Mostrador'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-600 dark:text-slate-500">
                            {new Date(q.createdAt).toLocaleDateString('es-MX')}
                          </span>
                          <Badge className={cn('border text-[10px]', statusColors[q.estado])}>
                            {statusLabels[q.estado]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-center text-xs text-cyan-500/80">Ver detalle…</p>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 self-start text-slate-600 dark:text-slate-500 hover:text-red-400"
                        aria-label="Eliminar cotización"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteQuotation(q);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Escritorio: tabla */}
              <div className="hidden min-h-0 min-w-0 md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-800">
                      <TableHead className="text-slate-600 dark:text-slate-400">Folio</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-400">Cliente</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-400">Fecha</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-400">Vigencia</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-400">Total</TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-400">Estado</TableHead>
                      <TableHead className="text-right text-slate-600 dark:text-slate-400">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center">
                          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
                        </TableCell>
                      </TableRow>
                    ) : filteredQuotations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-slate-600 dark:text-slate-500">
                          No se encontraron cotizaciones
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredQuotations.map((quotation) => (
                        <TableRow key={quotation.id} className="border-slate-200/80 dark:border-slate-800/50">
                          <TableCell className="font-medium text-slate-800 dark:text-slate-200">{quotation.folio}</TableCell>
                          <TableCell className="max-w-[12rem] truncate text-slate-600 dark:text-slate-400">
                            {quotation.cliente?.nombre || 'Mostrador'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {new Date(quotation.createdAt).toLocaleDateString('es-MX')}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {new Date(quotation.fechaVigencia).toLocaleDateString('es-MX')}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium text-cyan-400">
                            {formatMoney(quotation.total)}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn('border', statusColors[quotation.estado])}>
                              {statusLabels[quotation.estado]}
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
                                  onClick={() => openDetail(quotation)}
                                  className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                                >
                                  <FileText className="mr-2 h-4 w-4" />
                                  Ver Detalle
                                </DropdownMenuItem>
                                {quotation.estado === 'pendiente' && (
                                  <DropdownMenuItem
                                    onClick={() => handleConvertToSale(quotation)}
                                    className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                                  >
                                    <ShoppingCart className="mr-2 h-4 w-4" />
                                    Convertir a Venta
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => openEmailForQuotation(quotation)}
                                  className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                                >
                                  <Send className="mr-2 h-4 w-4" />
                                  Enviar por Email
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => void handleDeleteQuotation(quotation)}
                                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Eliminar
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
            </CardContent>
          </Card>
        </div>
      </PageShell>

      <SendEmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        subject={emailSubject}
        body={emailBody}
        title="Enviar cotización por correo"
      />

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-h-[min(92dvh,40rem)] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 sm:max-w-2xl lg:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Nueva Cotización</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-8">
            <div className="min-w-0 space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-600 dark:text-slate-400">Buscar Productos</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500" />
                  <Input
                    placeholder="Nombre, SKU o código..."
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 pl-9 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                {filteredProducts.slice(0, 20).map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleAddItem(product)}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/50 p-3 text-left last:border-0 hover:bg-slate-200/80 dark:bg-slate-800/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800 dark:text-slate-200">{product.nombre}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">{product.sku}</p>
                    </div>
                    <p className="shrink-0 text-sm text-cyan-400">{formatMoney(product.precioVenta)}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Productos seleccionados</label>
                <div className="divide-y divide-slate-200 dark:divide-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                  {quotationItems.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-600 dark:text-slate-500">No hay productos</p>
                  ) : (
                    quotationItems.map((item) => (
                      <div key={item.product.id} className="flex flex-wrap items-center gap-2 p-3">
                        <div className="min-w-0 flex-1 basis-[8rem]">
                          <p className="text-sm text-slate-800 dark:text-slate-200">{item.product.nombre}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleUpdateQuantity(item.product.id, item.quantity - 1)}
                            className="flex h-8 w-8 items-center justify-center rounded bg-slate-200 dark:bg-slate-800"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuantity(item.product.id, item.quantity + 1)}
                            className="flex h-8 w-8 items-center justify-center rounded bg-slate-200 dark:bg-slate-800"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="w-full text-right text-sm text-cyan-400 sm:w-auto sm:flex-1">
                          {formatMoney(item.product.precioVenta * item.quantity)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div>
                <label className="mb-2 block text-sm text-slate-600 dark:text-slate-400">Cliente</label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Mostrador</option>
                  {clients
                    .filter((c) => !c.isMostrador)
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.nombre}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-600 dark:text-slate-400">Vigencia (días)</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={vigenciaFocus && vigenciaDias === 0 ? '' : vigenciaDias}
                  onFocus={() => setVigenciaFocus(true)}
                  onBlur={() => {
                    setVigenciaFocus(false);
                    if (!vigenciaDias) setVigenciaDias(7);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') setVigenciaDias(0);
                    else setVigenciaDias(parseInt(v, 10) || 0);
                  }}
                  className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-600 dark:text-slate-400">Notas</label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                  placeholder="Condiciones, observaciones, etc."
                />
              </div>

              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span>{formatMoney(calculateTotals().subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>IVA (16%)</span>
                  <span>{formatMoney(calculateTotals().impuestos)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold text-slate-900 dark:text-slate-100">
                  <span>Total</span>
                  <span className="text-cyan-400">{formatMoney(calculateTotals().total)}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setShowAddDialog(false)}
              className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void handleSaveQuotation()}
              disabled={quotationItems.length === 0}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              <Check className="mr-2 h-4 w-4" />
              Guardar Cotización
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-h-[min(90dvh,36rem)] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cotización {selectedQuotation?.folio}</DialogTitle>
          </DialogHeader>

          {selectedQuotation && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Cliente</p>
                  <p className="text-slate-800 dark:text-slate-200">{selectedQuotation.cliente?.nombre || 'Mostrador'}</p>
                </div>
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Fecha</p>
                  <p className="text-slate-800 dark:text-slate-200">
                    {new Date(selectedQuotation.createdAt).toLocaleDateString('es-MX')}
                  </p>
                </div>
                <div>
                  <p className="text-slate-600 dark:text-slate-500">Cajero</p>
                  <p className="text-slate-800 dark:text-slate-200">
                    {selectedQuotation.usuarioNombre?.trim() || '—'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[20rem] text-sm">
                  <thead className="bg-slate-200/80 dark:bg-slate-800/50">
                    <tr>
                      <th className="p-3 text-left text-slate-600 dark:text-slate-400">Producto</th>
                      <th className="p-3 text-center text-slate-600 dark:text-slate-400">Cant.</th>
                      <th className="p-3 text-right text-slate-600 dark:text-slate-400">Precio</th>
                      <th className="p-3 text-right text-slate-600 dark:text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50">
                    {selectedQuotation.productos.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-3 text-slate-800 dark:text-slate-200">{item.producto?.nombre}</td>
                        <td className="p-3 text-center text-slate-600 dark:text-slate-400">{item.cantidad}</td>
                        <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                          {formatMoney(item.precioUnitario)}
                        </td>
                        <td className="p-3 text-right text-cyan-400">{formatMoney(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 dark:border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Badge className={cn('w-fit border', statusColors[selectedQuotation.estado])}>
                  {statusLabels[selectedQuotation.estado]}
                </Badge>
                <div className="text-right">
                  <p className="text-slate-600 dark:text-slate-500">Total</p>
                  <p className="text-2xl font-bold text-cyan-400">
                    {formatMoney(selectedQuotation.total)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  onClick={() => printQuotationLetter(selectedQuotation, effectiveSucursalId)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir (carta)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  onClick={() => openEmailForQuotation(selectedQuotation)}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Enviar por email
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
