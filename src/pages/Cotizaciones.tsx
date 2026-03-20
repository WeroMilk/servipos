import { useState } from 'react';
import { 
  Plus, 
  Search, 
  ShoppingCart,
  Check,
  X,
  MoreHorizontal,
  Send,
  FileText
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
import { useQuotations, useProducts, useClients } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Quotation, Product } from '@/types';
import { cn } from '@/lib/utils';
import { PageShell } from '@/components/ui-custom/PageShell';

const statusColors: Record<string, string> = {
  pendiente: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  aceptada: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  rechazada: 'bg-red-500/10 text-red-400 border-red-500/30',
  vencida: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  convertida: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
};

const statusLabels: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  convertida: 'Convertida',
};

export function Cotizaciones() {
  const { quotations, loading, addQuotation, convertToSale } = useQuotations();
  const { products } = useProducts();
  const { clients } = useClients();
  const { user } = useAuthStore();
  const { addToast } = useAppStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Cart state for new quotation
  const [quotationItems, setQuotationItems] = useState<{ product: Product; quantity: number; discount: number }[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [vigenciaDias, setVigenciaDias] = useState(7);
  const [notas, setNotas] = useState('');

  const handleAddItem = (product: Product) => {
    const existing = quotationItems.find(item => item.product.id === product.id);
    if (existing) {
      setQuotationItems(items =>
        items.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setQuotationItems([...quotationItems, { product, quantity: 1, discount: 0 }]);
    }
  };

  const handleRemoveItem = (productId: string) => {
    setQuotationItems(items => items.filter(item => item.product.id !== productId));
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }
    setQuotationItems(items =>
      items.map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      )
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
        productos: quotationItems.map(item => ({
          id: crypto.randomUUID(),
          productId: item.product.id,
          cantidad: item.quantity,
          precioUnitario: item.product.precioVenta,
          descuento: item.discount,
          impuesto: item.product.impuesto,
          subtotal: item.product.precioVenta * item.quantity * (1 - item.discount / 100),
          total: item.product.precioVenta * item.quantity * (1 - item.discount / 100) * (1 + item.product.impuesto / 100),
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
      } as any);

      setShowAddDialog(false);
      resetForm();
      addToast({ type: 'success', message: 'Cotización creada exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleConvertToSale = async (quotation: Quotation) => {
    try {
      await convertToSale(quotation.id, user?.id || 'system');
      addToast({ type: 'success', message: 'Cotización convertida a venta' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const resetForm = () => {
    setQuotationItems([]);
    setSelectedClient('');
    setVigenciaDias(7);
    setNotas('');
  };

  const filteredQuotations = quotations.filter(q =>
    q.folio.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.cliente?.nombre.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Folio o cliente..."
          className="h-9 w-full border-slate-800 bg-slate-900/50 pl-9 text-sm text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>

      <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
        <CardHeader className="shrink-0 space-y-0 py-2">
          <CardTitle className="text-sm text-slate-100 sm:text-base">Lista</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div className="min-h-0 min-w-0">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="w-[11%] text-slate-400">Folio</TableHead>
                  <TableHead className="w-[26%] text-slate-400">Cliente</TableHead>
                  <TableHead className="w-[11%] text-slate-400">Fecha</TableHead>
                  <TableHead className="w-[11%] text-slate-400">Vigencia</TableHead>
                  <TableHead className="w-[12%] text-slate-400">Total</TableHead>
                  <TableHead className="w-[14%] text-slate-400">Estado</TableHead>
                  <TableHead className="w-[15%] text-right text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredQuotations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                      No se encontraron cotizaciones
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredQuotations.map((quotation) => (
                    <TableRow key={quotation.id} className="border-slate-800/50">
                      <TableCell className="font-medium text-slate-200">{quotation.folio}</TableCell>
                      <TableCell className="max-w-0 truncate text-slate-400">
                        {quotation.cliente?.nombre || 'Mostrador'}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {new Date(quotation.createdAt).toLocaleDateString('es-MX')}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {new Date(quotation.fechaVigencia).toLocaleDateString('es-MX')}
                      </TableCell>
                      <TableCell className="text-cyan-400 font-medium">
                        ${quotation.total.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('border', statusColors[quotation.estado])}>
                          {statusLabels[quotation.estado]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-slate-400">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-slate-900 border-slate-800">
                            <DropdownMenuItem 
                              onClick={() => { setSelectedQuotation(quotation); setShowDetailDialog(true); }}
                              className="text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              Ver Detalle
                            </DropdownMenuItem>
                            {quotation.estado === 'pendiente' && (
                              <DropdownMenuItem 
                                onClick={() => handleConvertToSale(quotation)}
                                className="text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                              >
                                <ShoppingCart className="w-4 h-4 mr-2" />
                                Convertir a Venta
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem 
                              className="text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                            >
                              <Send className="w-4 h-4 mr-2" />
                              Enviar por Email
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

      {/* Add Quotation Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Nueva Cotización</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-6">
            {/* Left - Products */}
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Buscar Productos</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="Nombre, SKU o código..."
                    className="pl-9 bg-slate-800 border-slate-700 text-slate-100"
                    onChange={() => {
                      // Filter products - implementar búsqueda
                    }}
                  />
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg max-h-48 overflow-auto">
                {products.slice(0, 10).map(product => (
                  <button
                    key={product.id}
                    onClick={() => handleAddItem(product)}
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-800/50 
                               border-b border-slate-800/50 last:border-0 text-left"
                  >
                    <div>
                      <p className="text-sm text-slate-200">{product.nombre}</p>
                      <p className="text-xs text-slate-500">{product.sku}</p>
                    </div>
                    <p className="text-cyan-400 text-sm">${product.precioVenta.toFixed(2)}</p>
                  </button>
                ))}
              </div>

              {/* Selected Items */}
              <div className="space-y-2">
                <label className="text-sm text-slate-400">Productos Seleccionados</label>
                <div className="border border-slate-800 rounded-lg divide-y divide-slate-800/50">
                  {quotationItems.length === 0 ? (
                    <p className="p-4 text-center text-slate-500 text-sm">No hay productos</p>
                  ) : (
                    quotationItems.map(item => (
                      <div key={item.product.id} className="p-3 flex items-center gap-3">
                        <div className="flex-1">
                          <p className="text-sm text-slate-200">{item.product.nombre}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdateQuantity(item.product.id, item.quantity - 1)}
                            className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <button
                            onClick={() => handleUpdateQuantity(item.product.id, item.quantity + 1)}
                            className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-cyan-400 text-sm min-w-[80px] text-right">
                          ${(item.product.precioVenta * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right - Details */}
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Cliente</label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
                >
                  <option value="">Mostrador</option>
                  {clients.filter(c => !c.isMostrador).map(client => (
                    <option key={client.id} value={client.id}>{client.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Vigencia (días)</label>
                <Input
                  type="number"
                  value={vigenciaDias}
                  onChange={(e) => setVigenciaDias(parseInt(e.target.value) || 7)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Notas</label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 resize-none"
                  placeholder="Condiciones, observaciones, etc."
                />
              </div>

              {/* Totals */}
              <div className="border-t border-slate-800 pt-4 space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>${calculateTotals().subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>IVA (16%)</span>
                  <span>${calculateTotals().impuestos.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xl font-bold text-slate-100">
                  <span>Total</span>
                  <span className="text-cyan-400">${calculateTotals().total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-slate-700 text-slate-400">
              Cancelar
            </Button>
            <Button 
              onClick={handleSaveQuotation}
              disabled={quotationItems.length === 0}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Guardar Cotización
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cotización {selectedQuotation?.folio}</DialogTitle>
          </DialogHeader>
          
          {selectedQuotation && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-slate-500">Cliente</p>
                  <p className="text-slate-200">{selectedQuotation.cliente?.nombre || 'Mostrador'}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Fecha</p>
                  <p className="text-slate-200">
                    {new Date(selectedQuotation.createdAt).toLocaleDateString('es-MX')}
                  </p>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr>
                      <th className="text-left p-3 text-sm text-slate-400">Producto</th>
                      <th className="text-center p-3 text-sm text-slate-400">Cant.</th>
                      <th className="text-right p-3 text-sm text-slate-400">Precio</th>
                      <th className="text-right p-3 text-sm text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {selectedQuotation.productos.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-3 text-slate-200">{item.producto?.nombre}</td>
                        <td className="p-3 text-center text-slate-400">{item.cantidad}</td>
                        <td className="p-3 text-right text-slate-400">${item.precioUnitario.toFixed(2)}</td>
                        <td className="p-3 text-right text-cyan-400">${item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                <div>
                  <Badge className={cn('border', statusColors[selectedQuotation.estado])}>
                    {statusLabels[selectedQuotation.estado]}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Total</p>
                  <p className="text-2xl font-bold text-cyan-400">${selectedQuotation.total.toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
