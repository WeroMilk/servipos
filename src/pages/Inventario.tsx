import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Package, 
  AlertTriangle,
  Barcode,
  TrendingUp,
  MoreHorizontal,
  Printer,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardContent, CardTitle } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useProducts, useProductSearch, useEffectiveSucursalId, usePendingIncomingTransfers } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Product, Sucursal } from '@/types';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { confirmIncomingStoreTransfer } from '@/lib/firestore/storeTransfersFirestore';
import { cn, formatMoney } from '@/lib/utils';
import { PageShell } from '@/components/ui-custom/PageShell';
import { printThermalLowStockReport } from '@/lib/printTicket';
import { formatInAppTimezone } from '@/lib/appTimezone';

type InventoryMode = 'productos' | 'stock' | 'valor' | 'codigos';

/**
 * Stock bajo: sin existencia; existencia &lt; 15% del mínimo (si hay mínimo &gt; 0);
 * o existencia en o por debajo del mínimo configurado.
 */
function isStockBajo(p: { existencia: number; existenciaMinima: number }): boolean {
  if (p.existencia <= 0) return true;
  if (p.existenciaMinima > 0 && p.existencia / p.existenciaMinima < 0.15) return true;
  return p.existencia <= p.existenciaMinima;
}

export function Inventario() {
  const [searchParams] = useSearchParams();
  const { products, loading, addProduct, editProduct, removeProduct, adjustStock } = useProducts();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { addToast } = useAppStore();
  const { user } = useAuthStore();
  const { pendingIncoming } = usePendingIncomingTransfers();
  const [sucursalesCat, setSucursalesCat] = useState<Sucursal[]>([]);
  const [confirmingTransferId, setConfirmingTransferId] = useState<string | null>(null);

  useEffect(() => subscribeSucursales(setSucursalesCat), []);

  const nombreSucursal = useCallback(
    (id: string) => sucursalesCat.find((s) => s.id === id)?.nombre?.trim() || id,
    [sucursalesCat]
  );

  const handleConfirmIncomingTransfer = useCallback(
    async (transferId: string) => {
      if (!effectiveSucursalId || !user?.id) return;
      const actor =
        user.name?.trim() || user.username?.trim() || user.email?.trim() || 'Usuario';
      setConfirmingTransferId(transferId);
      try {
        await confirmIncomingStoreTransfer(effectiveSucursalId, transferId, user.id, actor);
        addToast({ type: 'success', message: 'Traspaso recibido; el stock de esta tienda se actualizó.' });
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'No se pudo confirmar el traspaso',
        });
      } finally {
        setConfirmingTransferId(null);
      }
    },
    [effectiveSucursalId, user, addToast]
  );
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState({ tipo: 'entrada', cantidad: 0, motivo: '' });
  const [stockQtyFocus, setStockQtyFocus] = useState(false);
  /** Al enfocar, ocultar 0 para escribir sin borrar; al salir vacío queda 0 en estado. */
  const [addNumFocus, setAddNumFocus] = useState({
    precioVenta: false,
    precioCompra: false,
    existencia: false,
    existenciaMinima: false,
  });
  const [editNumFocus, setEditNumFocus] = useState({
    precioVenta: false,
    precioCompra: false,
    existenciaMinima: false,
  });
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>('productos');
  const [skuDrafts, setSkuDrafts] = useState<Record<string, string>>({});

  // Form state
  const [formData, setFormData] = useState({
    sku: '',
    codigoBarras: '',
    nombre: '',
    descripcion: '',
    precioVenta: 0,
    precioCompra: 0,
    impuesto: 16,
    existencia: 0,
    existenciaMinima: 0,
    categoria: '',
    proveedor: '',
    unidadMedida: 'H87',
  });

  const { results: searchResults, search } = useProductSearch();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    search(query);
  };

  useEffect(() => {
    const t = searchParams.get('tab') || searchParams.get('focus');
    if (t === 'stock' || t === 'bajo') {
      setInventoryMode('stock');
    }
  }, [searchParams]);

  useEffect(() => {
    if (showAddDialog) {
      setAddNumFocus({
        precioVenta: false,
        precioCompra: false,
        existencia: false,
        existenciaMinima: false,
      });
    }
  }, [showAddDialog]);

  useEffect(() => {
    if (showEditDialog) {
      setEditNumFocus({ precioVenta: false, precioCompra: false, existenciaMinima: false });
    }
  }, [showEditDialog]);

  const handleAddProduct = async () => {
    try {
      await addProduct({
        ...formData,
        activo: true,
      } as any);
      setShowAddDialog(false);
      resetForm();
      addToast({ type: 'success', message: 'Producto agregado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleEditProduct = async () => {
    if (!selectedProduct) return;
    
    try {
      await editProduct(selectedProduct.id, formData);
      setShowEditDialog(false);
      setSelectedProduct(null);
      addToast({ type: 'success', message: 'Producto actualizado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    if (!confirm(`¿Está seguro de eliminar ${product.nombre}?`)) return;
    
    try {
      await removeProduct(product.id);
      addToast({ type: 'success', message: 'Producto eliminado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleStockAdjustment = async () => {
    if (!selectedProduct) return;
    
    try {
      await adjustStock(
        selectedProduct.id,
        stockAdjustment.cantidad,
        stockAdjustment.tipo as any,
        stockAdjustment.motivo,
        undefined,
        'system'
      );
      setShowStockDialog(false);
      setSelectedProduct(null);
      setStockAdjustment({ tipo: 'entrada', cantidad: 0, motivo: '' });
      addToast({ type: 'success', message: 'Stock ajustado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const openEditDialog = (product: Product) => {
    setSelectedProduct(product);
    setFormData({
      sku: product.sku,
      codigoBarras: product.codigoBarras || '',
      nombre: product.nombre,
      descripcion: product.descripcion || '',
      precioVenta: product.precioVenta,
      precioCompra: product.precioCompra || 0,
      impuesto: product.impuesto,
      existencia: product.existencia,
      existenciaMinima: product.existenciaMinima,
      categoria: product.categoria || '',
      proveedor: product.proveedor || '',
      unidadMedida: product.unidadMedida,
    });
    setShowEditDialog(true);
  };

  const openStockDialog = (product: Product) => {
    setSelectedProduct(product);
    setStockAdjustment({ tipo: 'entrada', cantidad: 0, motivo: '' });
    setStockQtyFocus(false);
    setShowStockDialog(true);
  };

  const valorInventarioTotal = useMemo(
    () => products.reduce((sum, p) => sum + p.precioVenta * p.existencia, 0),
    [products]
  );

  const stockBajoCount = useMemo(
    () => products.filter(isStockBajo).length,
    [products]
  );

  const pool = useMemo(() => {
    return searchQuery.trim() ? searchResults : products;
  }, [searchQuery, searchResults, products]);

  const displayProducts = useMemo(() => {
    let list = [...pool];
    if (inventoryMode === 'stock') {
      list = list.filter(isStockBajo);
    }
    if (inventoryMode === 'productos' || inventoryMode === 'stock' || inventoryMode === 'codigos') {
      list.sort((a, b) =>
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es', { sensitivity: 'base' })
      );
    } else if (inventoryMode === 'valor') {
      list.sort(
        (a, b) =>
          b.precioVenta - a.precioVenta ||
          String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es')
      );
    }
    return list;
  }, [pool, inventoryMode]);

  useEffect(() => {
    if (inventoryMode !== 'codigos') return;
    setSkuDrafts((prev) => {
      const next = { ...prev };
      for (const p of products) {
        if (next[p.id] === undefined) next[p.id] = p.sku;
      }
      return next;
    });
  }, [inventoryMode, products]);

  const handleSkuDraftChange = useCallback((id: string, value: string) => {
    setSkuDrafts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const commitSkuIfChanged = useCallback(
    async (product: Product) => {
      const raw = (skuDrafts[product.id] ?? product.sku).trim();
      if (raw === product.sku) return;
      if (!raw) {
        addToast({ type: 'error', message: 'El SKU no puede estar vacío' });
        setSkuDrafts((prev) => ({ ...prev, [product.id]: product.sku }));
        return;
      }
      const taken = products.some(
        (p) => p.id !== product.id && p.sku.toLowerCase() === raw.toLowerCase()
      );
      if (taken) {
        addToast({ type: 'error', message: 'Ese SKU ya está en uso' });
        setSkuDrafts((prev) => ({ ...prev, [product.id]: product.sku }));
        return;
      }
      try {
        await editProduct(product.id, { sku: raw });
        addToast({ type: 'success', message: 'SKU actualizado' });
      } catch (e: unknown) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo guardar el SKU',
        });
        setSkuDrafts((prev) => ({ ...prev, [product.id]: product.sku }));
      }
    },
    [skuDrafts, products, editProduct, addToast]
  );

  const modeHint: Record<InventoryMode, string> = {
    productos: 'Orden alfabético por nombre (A-Z).',
    stock: 'Stock en cero, por debajo del mínimo, o por debajo del 15% del mínimo configurado.',
    valor: 'Ordenados del precio de venta más alto al más bajo.',
    codigos: 'Nombre y SKU. Edita el SKU y guarda al salir del campo.',
  };

  const resetForm = () => {
    setFormData({
      sku: '',
      codigoBarras: '',
      nombre: '',
      descripcion: '',
      precioVenta: 0,
      precioCompra: 0,
      impuesto: 16,
      existencia: 0,
      existenciaMinima: 0,
      categoria: '',
      proveedor: '',
      unidadMedida: 'H87',
    });
  };

  return (
    <>
    <PageShell
      title="Inventario"
      subtitle="Productos y stock"
      className="min-w-0 max-w-none"
      actions={
        <Button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          size="sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo
        </Button>
      }
    >
      <div className="grid w-full min-w-0 shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <button
          type="button"
          onClick={() => setInventoryMode('productos')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'productos'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 sm:h-10 sm:w-10">
              <Package className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{products.length}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Productos</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryMode('stock')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'stock'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 sm:h-10 sm:w-10">
              <AlertTriangle className="h-4 w-4 text-amber-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{stockBajoCount}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Stock bajo</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryMode('valor')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'valor'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 sm:h-10 sm:w-10">
              <TrendingUp className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-lg">
                {formatMoney(valorInventarioTotal)}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Valor</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryMode('codigos')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'codigos'
              ? 'border-cyan-500/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-cyan-500/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 sm:h-10 sm:w-10">
              <Barcode className="h-4 w-4 text-violet-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
                {products.filter((p) => p.codigoBarras).length}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Códigos</p>
            </div>
          </CardContent>
        </button>
      </div>

      {effectiveSucursalId && pendingIncoming.length > 0 ? (
        <div className="mt-3 shrink-0 rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 sm:mt-4 sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200/95">
            <Truck className="h-4 w-4 shrink-0 text-amber-400" />
            Traspasos pendientes de recibir
            <Badge variant="secondary" className="border-amber-500/40 bg-amber-500/15 text-amber-200">
              {pendingIncoming.length}
            </Badge>
          </div>
          <p className="mb-2 text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
            Otro almacén envió mercancía a esta tienda. Confirma cuando la hayas recibido físicamente para sumar el
            inventario aquí.
          </p>
          <div
            className="w-full snap-x snap-mandatory overflow-x-auto overflow-y-visible scroll-smooth [-webkit-overflow-scrolling:touch]"
            style={{ scrollbarWidth: 'thin' }}
          >
            <div className="grid auto-cols-[100%] grid-flow-col gap-3">
              {pendingIncoming.map((t) => (
                <div key={t.id} className="min-w-0 snap-center snap-always px-0.5">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 p-3 text-xs text-slate-700 dark:text-slate-300 sm:text-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          Desde {nombreSucursal(t.origenSucursalId)} ·{' '}
                          <span className="font-mono text-cyan-400/90">{t.origenFolio}</span>
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-500">
                          {t.items.length} partida(s) ·{' '}
                          {t.items.reduce((s, it) => s + it.cantidad, 0)} pzas. total
                          {t.usuarioNombre ? ` · Enviado por ${t.usuarioNombre}` : ''}
                        </p>
                        <ul className="mt-2 max-h-24 list-inside list-disc overflow-y-auto text-[11px] text-slate-600 dark:text-slate-500">
                          {t.items.map((it, i) => (
                            <li key={i}>
                              {it.nombre} × {it.cantidad}
                              {it.sku ? ` (SKU ${it.sku})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={confirmingTransferId === t.id}
                        className="w-full shrink-0 bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto"
                        onClick={() => void handleConfirmIncomingTransfer(t.id)}
                      >
                        {confirmingTransferId === t.id ? 'Confirmando…' : 'Confirmar recepción'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex shrink-0 justify-end pb-2 sm:mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-amber-500/40 text-amber-200/90 hover:bg-amber-500/10"
          onClick={() => {
            const items = products.filter(isStockBajo).map((p) => ({
              nombre: p.nombre,
              sku: p.sku,
              existencia: p.existencia,
              existenciaMinima: p.existenciaMinima,
            }));
            printThermalLowStockReport({
              fechaLabel: formatInAppTimezone(new Date(), {
                dateStyle: 'full',
                timeStyle: 'short',
              }),
              sucursalId: effectiveSucursalId,
              items,
            });
            if (items.length === 0) {
              addToast({ type: 'info', message: 'No hay artículos con stock bajo en esta tienda' });
            }
          }}
        >
          <Printer className="mr-2 h-4 w-4" />
          Ticket stock bajo
        </Button>
      </div>

      <div className="relative mt-3 mb-3 w-full min-w-0 shrink-0 sm:mt-4 sm:mb-4">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar nombre, SKU, código..."
          className="h-9 w-full border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 pl-9 text-sm text-slate-900 dark:text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 pb-1">
          <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">Lista de productos</CardTitle>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">{modeHint[inventoryMode]}</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/40 shadow-inner">
          <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
            <div className="min-w-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                    {inventoryMode === 'codigos' ? (
                      <>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Producto
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          SKU
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 w-24 bg-white/95 dark:bg-slate-950/95 text-right text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Acciones
                        </TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Producto
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          SKU
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Precio
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Stock
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Categoría
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-right text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Acciones
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={inventoryMode === 'codigos' ? 3 : 6}
                        className="py-8 text-center"
                      >
                        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
                      </TableCell>
                    </TableRow>
                  ) : displayProducts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={inventoryMode === 'codigos' ? 3 : 6}
                        className="py-8 text-center text-slate-600 dark:text-slate-500"
                      >
                        No se encontraron productos
                      </TableCell>
                    </TableRow>
                  ) : inventoryMode === 'codigos' ? (
                    displayProducts.map((product) => (
                      <TableRow key={product.id} className="border-slate-200/80 dark:border-slate-800/50">
                        <TableCell className="font-medium text-slate-800 dark:text-slate-200">{product.nombre}</TableCell>
                        <TableCell>
                          <Input
                            value={skuDrafts[product.id] ?? product.sku}
                            onChange={(e) => handleSkuDraftChange(product.id, e.target.value)}
                            onBlur={() => void commitSkuIfChanged(product)}
                            className="h-9 min-w-[8rem] border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800/80 font-mono text-sm text-slate-900 dark:text-slate-100"
                            aria-label={`SKU de ${product.nombre}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="text-slate-600 dark:text-slate-400">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                              <DropdownMenuItem
                                onClick={() => openEditDialog(product)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                              >
                                <Edit2 className="mr-2 h-4 w-4" />
                                Editar completo
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteProduct(product)}
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
                  ) : (
                    displayProducts.map((product) => (
                      <TableRow key={product.id} className="border-slate-200/80 dark:border-slate-800/50">
                        <TableCell>
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-200">{product.nombre}</p>
                            {product.descripcion ? (
                              <p className="text-xs text-slate-600 dark:text-slate-500">{product.descripcion}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">{product.sku}</TableCell>
                        <TableCell className="font-medium tabular-nums text-cyan-400">
                          {formatMoney(product.precioVenta)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'font-medium',
                                product.existencia <= product.existenciaMinima
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              )}
                            >
                              {product.existencia}
                            </span>
                            {product.existencia <= product.existenciaMinima ? (
                              <AlertTriangle className="h-4 w-4 text-amber-400" />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {product.categoria || 'Sin categoría'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="text-slate-600 dark:text-slate-400">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                              <DropdownMenuItem
                                onClick={() => openEditDialog(product)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                              >
                                <Edit2 className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openStockDialog(product)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                              >
                                <TrendingUp className="mr-2 h-4 w-4" />
                                Ajustar Stock
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteProduct(product)}
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
          </div>
        </div>
      </div>
    </PageShell>

      {/* Add Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Nuevo Producto</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>SKU *</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Código de Barras</Label>
              <Input
                value={formData.codigoBarras}
                onChange={(e) => setFormData({ ...formData, codigoBarras: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Descripción</Label>
              <Input
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de Venta *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={addNumFocus.precioVenta && formData.precioVenta === 0 ? '' : formData.precioVenta}
                onFocus={() => setAddNumFocus((f) => ({ ...f, precioVenta: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, precioVenta: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioVenta: 0 }));
                  else setFormData((d) => ({ ...d, precioVenta: parseFloat(v) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de Compra</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={addNumFocus.precioCompra && formData.precioCompra === 0 ? '' : formData.precioCompra}
                onFocus={() => setAddNumFocus((f) => ({ ...f, precioCompra: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, precioCompra: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioCompra: 0 }));
                  else setFormData((d) => ({ ...d, precioCompra: parseFloat(v) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Stock Inicial</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={addNumFocus.existencia && formData.existencia === 0 ? '' : formData.existencia}
                onFocus={() => setAddNumFocus((f) => ({ ...f, existencia: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, existencia: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, existencia: 0 }));
                  else setFormData((d) => ({ ...d, existencia: parseInt(v, 10) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Stock Mínimo</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={addNumFocus.existenciaMinima && formData.existenciaMinima === 0 ? '' : formData.existenciaMinima}
                onFocus={() => setAddNumFocus((f) => ({ ...f, existenciaMinima: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, existenciaMinima: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, existenciaMinima: 0 }));
                  else setFormData((d) => ({ ...d, existenciaMinima: parseInt(v, 10) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Input
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Input
                value={formData.proveedor}
                onChange={(e) => setFormData({ ...formData, proveedor: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddDialog(false)}
              className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleAddProduct()}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Guardar Producto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog - Similar al Add */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Editar Producto</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            {/* Mismos campos que Add Dialog */}
            <div className="space-y-2">
              <Label>SKU *</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Código de Barras</Label>
              <Input
                value={formData.codigoBarras}
                onChange={(e) => setFormData({ ...formData, codigoBarras: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Descripción</Label>
              <Input
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de Venta *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={editNumFocus.precioVenta && formData.precioVenta === 0 ? '' : formData.precioVenta}
                onFocus={() => setEditNumFocus((f) => ({ ...f, precioVenta: true }))}
                onBlur={() => setEditNumFocus((f) => ({ ...f, precioVenta: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioVenta: 0 }));
                  else setFormData((d) => ({ ...d, precioVenta: parseFloat(v) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de Compra</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={editNumFocus.precioCompra && formData.precioCompra === 0 ? '' : formData.precioCompra}
                onFocus={() => setEditNumFocus((f) => ({ ...f, precioCompra: true }))}
                onBlur={() => setEditNumFocus((f) => ({ ...f, precioCompra: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioCompra: 0 }));
                  else setFormData((d) => ({ ...d, precioCompra: parseFloat(v) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Stock Mínimo</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={
                  editNumFocus.existenciaMinima && formData.existenciaMinima === 0 ? '' : formData.existenciaMinima
                }
                onFocus={() => setEditNumFocus((f) => ({ ...f, existenciaMinima: true }))}
                onBlur={() => setEditNumFocus((f) => ({ ...f, existenciaMinima: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, existenciaMinima: 0 }));
                  else setFormData((d) => ({ ...d, existenciaMinima: parseInt(v, 10) || 0 }));
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Input
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleEditProduct()}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Actualizar Producto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Adjustment Dialog */}
      <Dialog open={showStockDialog} onOpenChange={setShowStockDialog}>
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
          <DialogHeader>
            <DialogTitle>Ajustar Stock - {selectedProduct?.nombre}</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-slate-200/80 dark:bg-slate-800/50">
              <p className="text-sm text-slate-600 dark:text-slate-400">Stock Actual</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{selectedProduct?.existencia}</p>
            </div>

            <div className="space-y-2">
              <Label>Tipo de Ajuste</Label>
              <select
                value={stockAdjustment.tipo}
                onChange={(e) => setStockAdjustment({ ...stockAdjustment, tipo: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              >
                <option value="entrada">Entrada</option>
                <option value="salida">Salida</option>
                <option value="ajuste">Ajuste Directo</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={stockQtyFocus && stockAdjustment.cantidad === 0 ? '' : stockAdjustment.cantidad}
                onFocus={() => setStockQtyFocus(true)}
                onBlur={() => setStockQtyFocus(false)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setStockAdjustment((s) => ({ ...s, cantidad: 0 }));
                  else setStockAdjustment((s) => ({ ...s, cantidad: parseInt(v, 10) || 0 }));
                }}
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input
                value={stockAdjustment.motivo}
                onChange={(e) => setStockAdjustment({ ...stockAdjustment, motivo: e.target.value })}
                placeholder="Ej: Compra a proveedor, merma, etc."
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowStockDialog(false)}
              className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleStockAdjustment()}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Aplicar Ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
