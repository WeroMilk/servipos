import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
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
  Clock,
  CircleDollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardContent, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useProducts,
  useProductSearch,
  useEffectiveSucursalId,
  usePendingIncomingTransfers,
  useInventoryMovementsHistory,
} from '@/hooks';
import { useAppStore, useAuthStore, useInventoryListsStore } from '@/stores';
import type { InventoryMovement, Product, Sucursal } from '@/types';
import {
  CLIENT_PRICE_LIST_ORDER,
  CLIENT_PRICE_LABELS,
  type ClientPriceListId,
} from '@/lib/clientPriceLists';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { clearAllInventoryMovementsLocal, getInventoryMovementsByProductId } from '@/db/database';
import { deleteAllInventoryMovementsFirestore } from '@/lib/firestore/inventoryMovementsFirestore';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { confirmIncomingStoreTransfer } from '@/lib/firestore/storeTransfersFirestore';
import { cn, formatMoney } from '@/lib/utils';
import {
  SAT_CLAVES_UNIDAD,
  normalizeClaveProdServ,
  normalizeClaveUnidadSat,
  isValidClaveProdServSat,
} from '@/lib/satCatalog';
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

function isCatalogInventoryMovement(t: InventoryMovement['tipo']): boolean {
  return t === 'producto_alta' || t === 'producto_baja' || t === 'producto_edicion';
}

function tipoMovimientoLabel(t: InventoryMovement['tipo']): string {
  const labels: Record<InventoryMovement['tipo'], string> = {
    entrada: 'Entrada',
    salida: 'Salida',
    ajuste: 'Ajuste',
    venta: 'Venta',
    compra: 'Compra',
    producto_alta: 'Catálogo · Alta',
    producto_baja: 'Catálogo · Baja',
    producto_edicion: 'Catálogo · Edición',
  };
  return labels[t];
}

function InventarioCurrencyInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-sm font-medium text-slate-600 dark:text-slate-400"
        aria-hidden
      >
        $
      </span>
      <Input {...props} className={cn('pl-7', className)} />
    </div>
  );
}

function emptyPreciosListaStr(): Record<ClientPriceListId, string> {
  const o = {} as Record<ClientPriceListId, string>;
  for (const id of CLIENT_PRICE_LIST_ORDER) o[id] = '';
  return o;
}

function parsePreciosListaForm(
  strMap: Record<ClientPriceListId, string>
): Product['preciosPorListaCliente'] | undefined {
  const out: Partial<Record<ClientPriceListId, number>> = {};
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const t = (strMap[id] ?? '').replace(',', '.').trim();
    if (t === '') continue;
    const n = parseFloat(t);
    if (Number.isFinite(n) && n >= 0) out[id] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Catálogo guarda `precioVenta` sin IVA; en formulario el usuario captura sin IVA y se muestra el equivalente con IVA. */
function precioVentaSinIvaToConIva(sinIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  return roundMoney2(sinIva * (1 + imp / 100));
}

/** Texto de catálogo en mayúsculas aunque el usuario escriba en minúsculas. */
function upperTxt(s: string): string {
  return s.toLocaleUpperCase('es');
}

type AddSessionLine = { nombre: string; sku: string; subtotalSinIva: number };

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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState({
    tipo: 'entrada',
    cantidad: 0,
    motivo: '',
    proveedorEntrada: '',
    precioCompraUnit: 0,
  });
  const [stockQtyFocus, setStockQtyFocus] = useState(false);
  const [stockPrecioCompraFocus, setStockPrecioCompraFocus] = useState(false);
  const addCodigoBarrasRef = useRef<HTMLInputElement>(null);
  const addSessionLinesRef = useRef<AddSessionLine[]>([]);
  const [addSessionSummaryOpen, setAddSessionSummaryOpen] = useState(false);
  const [addSessionSummaryLines, setAddSessionSummaryLines] = useState<AddSessionLine[]>([]);
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
  const [movementsHistoryOpen, setMovementsHistoryOpen] = useState(false);
  const [clearMovementsConfirmOpen, setClearMovementsConfirmOpen] = useState(false);
  const [clearingMovements, setClearingMovements] = useState(false);
  const [preciosDialogOpen, setPreciosDialogOpen] = useState(false);
  const [preciosDialogProduct, setPreciosDialogProduct] = useState<Product | null>(null);
  const [productEntradasHist, setProductEntradasHist] = useState<InventoryMovement[]>([]);
  const [productEntradasHistLoading, setProductEntradasHistLoading] = useState(false);
  const [editPreciosSectionOpen, setEditPreciosSectionOpen] = useState(false);

  const isAdmin = user?.role === 'admin';
  const {
    movements: inventoryMovements,
    loading: inventoryMovementsLoading,
    refreshLocal: refreshInventoryMovementsLocal,
  } = useInventoryMovementsHistory(movementsHistoryOpen);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const sortedProductsForTemplate = useMemo(
    () =>
      [...products].sort((a, b) =>
        (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
      ),
    [products]
  );

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
    claveProdServ: '',
  });

  const [preciosListaStr, setPreciosListaStr] = useState(emptyPreciosListaStr);
  const [addFormTemplateId, setAddFormTemplateId] = useState<string>('__none__');
  const categoriasLista = useInventoryListsStore((s) => s.categorias);
  const proveedoresLista = useInventoryListsStore((s) => s.proveedores);

  const categoriaSelectOptions = useMemo(() => {
    const s = new Set(categoriasLista);
    if (formData.categoria && !s.has(formData.categoria)) {
      return [formData.categoria, ...categoriasLista];
    }
    return categoriasLista;
  }, [categoriasLista, formData.categoria]);

  const proveedorSelectOptions = useMemo(() => {
    const s = new Set(proveedoresLista);
    if (formData.proveedor && !s.has(formData.proveedor)) {
      return [formData.proveedor, ...proveedoresLista];
    }
    return proveedoresLista;
  }, [proveedoresLista, formData.proveedor]);

  const stockProveedorOptions = useMemo(() => {
    const s = new Set(proveedoresLista);
    const pe = stockAdjustment.proveedorEntrada.trim();
    if (pe && !s.has(pe)) return [pe, ...proveedoresLista];
    return proveedoresLista;
  }, [proveedoresLista, stockAdjustment.proveedorEntrada]);

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

  /** Tras un movimiento de stock, el catálogo se actualiza: sincronizar existencia en el editor abierto. */
  useEffect(() => {
    if (!showEditDialog || !selectedProduct) return;
    const fresh = products.find((p) => p.id === selectedProduct.id);
    if (!fresh || fresh.existencia === selectedProduct.existencia) return;
    setSelectedProduct(fresh);
    setFormData((fd) => ({ ...fd, existencia: fresh.existencia }));
  }, [products, showEditDialog, selectedProduct?.id, selectedProduct?.existencia]);

  const handleAddProduct = async (andAnother = false) => {
    const nombre = upperTxt(formData.nombre.trim());
    if (!nombre) {
      addToast({ type: 'warning', message: 'El nombre es obligatorio' });
      return;
    }
    const codigoBarras = upperTxt((formData.codigoBarras ?? '').trim());
    if (!codigoBarras) {
      addToast({ type: 'warning', message: 'El código de barras es obligatorio' });
      return;
    }
    const skuTrim = upperTxt((formData.sku ?? '').trim());
    const skuFinal = skuTrim || codigoBarras;
    const cps = normalizeClaveProdServ(formData.claveProdServ);
    if (!isValidClaveProdServSat(cps)) {
      addToast({
        type: 'warning',
        message: 'Indique la clave Producto/Servicio SAT con 8 dígitos (ej. 31171504), según el catálogo del SAT.',
      });
      return;
    }
    const proveedorGuardado = formData.proveedor.trim();
    const descripcionUpper = upperTxt((formData.descripcion ?? '').trim());
    const compraSubSinIva = roundMoney2(
      Math.max(0, Number(formData.precioCompra) || 0) * Math.max(0, Number(formData.existencia) || 0)
    );
    const preciosPorListaCliente = parsePreciosListaForm(preciosListaStr);
    try {
      await addProduct({
        ...formData,
        nombre,
        descripcion: descripcionUpper,
        sku: skuFinal,
        codigoBarras,
        activo: true,
        unidadMedida: normalizeClaveUnidadSat(formData.unidadMedida),
        claveProdServ: cps,
        preciosPorListaCliente: preciosPorListaCliente ?? {},
      } as any);
      addSessionLinesRef.current = [
        ...addSessionLinesRef.current,
        { nombre, sku: skuFinal, subtotalSinIva: compraSubSinIva },
      ];
      if (andAnother) {
        setAddFormTemplateId('__none__');
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
          proveedor: proveedorGuardado,
          unidadMedida: 'H87',
          claveProdServ: '',
        });
        setPreciosListaStr(emptyPreciosListaStr());
        setAddNumFocus({
          precioVenta: false,
          precioCompra: false,
          existencia: false,
          existenciaMinima: false,
        });
        addToast({
          type: 'success',
          message: 'Producto agregado. El proveedor se mantuvo; capture el siguiente artículo.',
        });
        requestAnimationFrame(() => addCodigoBarrasRef.current?.focus());
      } else {
        setShowAddDialog(false);
        resetForm();
        addToast({ type: 'success', message: 'Producto agregado exitosamente' });
      }
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleEditProduct = async () => {
    if (!selectedProduct) return;

    const preciosPorListaCliente = parsePreciosListaForm(preciosListaStr);

    try {
      const cpsEdit = normalizeClaveProdServ(formData.claveProdServ);
      if (!isValidClaveProdServSat(cpsEdit)) {
        addToast({
          type: 'warning',
          message: 'La clave Producto/Servicio SAT debe tener 8 dígitos (catálogo SAT).',
        });
        return;
      }
      await editProduct(selectedProduct.id, {
        ...formData,
        nombre: upperTxt(formData.nombre.trim()),
        descripcion: upperTxt((formData.descripcion ?? '').trim()),
        sku: upperTxt((formData.sku ?? '').trim()),
        codigoBarras: upperTxt((formData.codigoBarras ?? '').trim()),
        unidadMedida: normalizeClaveUnidadSat(formData.unidadMedida),
        claveProdServ: cpsEdit,
        preciosPorListaCliente: preciosPorListaCliente ?? {},
      });
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
    const motivoMovTrim = (stockAdjustment.motivo ?? '').trim();
    const motivoMov = motivoMovTrim ? upperTxt(motivoMovTrim) : '';

    try {
      const entradaMeta =
        stockAdjustment.tipo === 'entrada'
          ? {
              proveedor: stockAdjustment.proveedorEntrada.trim() || undefined,
              precioUnitarioCompra:
                stockAdjustment.precioCompraUnit > 0 ? stockAdjustment.precioCompraUnit : undefined,
            }
          : undefined;
      await adjustStock(
        selectedProduct.id,
        stockAdjustment.cantidad,
        stockAdjustment.tipo as any,
        motivoMov,
        undefined,
        'system',
        entradaMeta
      );
      setStockAdjustment({
        tipo: 'entrada',
        cantidad: 0,
        motivo: '',
        proveedorEntrada: formData.proveedor.trim() || '',
        precioCompraUnit: formData.precioCompra > 0 ? formData.precioCompra : 0,
      });
      setStockQtyFocus(false);
      setStockPrecioCompraFocus(false);
      addToast({ type: 'success', message: 'Stock ajustado exitosamente' });
    } catch (error: any) {
      addToast({ type: 'error', message: error.message });
    }
  };

  const handleClearInventoryMovements = useCallback(async () => {
    setClearingMovements(true);
    try {
      if (effectiveSucursalId) {
        await deleteAllInventoryMovementsFirestore(effectiveSucursalId);
      } else {
        await clearAllInventoryMovementsLocal();
      }
      addToast({ type: 'success', message: 'Historial de movimientos vaciado.' });
      setClearMovementsConfirmOpen(false);
      if (!effectiveSucursalId) await refreshInventoryMovementsLocal();
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo vaciar el historial',
      });
    } finally {
      setClearingMovements(false);
    }
  }, [effectiveSucursalId, addToast, refreshInventoryMovementsLocal]);

  const applyProductTemplateToAddForm = useCallback(
    (product: Product) => {
      const p = productById.get(product.id) ?? product;
      setFormData({
        sku: p.sku,
        codigoBarras: p.codigoBarras || '',
        nombre: p.nombre,
        descripcion: p.descripcion || '',
        precioVenta: p.precioVenta,
        precioCompra: p.precioCompra || 0,
        impuesto: p.impuesto,
        existencia: p.existencia,
        existenciaMinima: p.existenciaMinima,
        categoria: p.categoria || '',
        proveedor: p.proveedor || '',
        unidadMedida: normalizeClaveUnidadSat(p.unidadMedida),
        claveProdServ: p.claveProdServ ?? '',
      });
      const pl = emptyPreciosListaStr();
      for (const id of CLIENT_PRICE_LIST_ORDER) {
        const v = p.preciosPorListaCliente?.[id];
        pl[id] = v != null && Number.isFinite(v) ? String(v) : '';
      }
      setPreciosListaStr(pl);
    },
    [productById]
  );

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
      unidadMedida: normalizeClaveUnidadSat(product.unidadMedida),
      claveProdServ: product.claveProdServ ?? '',
    });
    const pl = emptyPreciosListaStr();
    for (const id of CLIENT_PRICE_LIST_ORDER) {
      const v = product.preciosPorListaCliente?.[id];
      pl[id] = v != null && Number.isFinite(v) ? String(v) : '';
    }
    setPreciosListaStr(pl);
    setStockAdjustment({
      tipo: 'entrada',
      cantidad: 0,
      motivo: '',
      proveedorEntrada: product.proveedor?.trim() || '',
      precioCompraUnit: product.precioCompra && product.precioCompra > 0 ? product.precioCompra : 0,
    });
    setStockQtyFocus(false);
    setStockPrecioCompraFocus(false);
    setEditPreciosSectionOpen(false);
    setShowEditDialog(true);
  };

  const openPreciosDialog = useCallback(
    (product: Product) => {
      const p = productById.get(product.id) ?? product;
      setPreciosDialogProduct(p);
      setPreciosDialogOpen(true);
    },
    [productById]
  );

  useEffect(() => {
    if (!preciosDialogOpen || !preciosDialogProduct) {
      setProductEntradasHist([]);
      setProductEntradasHistLoading(false);
      return;
    }
    const pid = preciosDialogProduct.id;
    let cancelled = false;
    setProductEntradasHistLoading(true);
    setProductEntradasHist([]);
    void getInventoryMovementsByProductId(pid, { sucursalId: effectiveSucursalId, limit: 200 })
      .then((rows: InventoryMovement[]) => {
        if (cancelled) return;
        const entradas = rows.filter(
          (m: InventoryMovement) => (m.tipo === 'entrada' || m.tipo === 'compra') && m.cantidad > 0
        );
        setProductEntradasHist(entradas);
      })
      .catch(() => {
        if (!cancelled) setProductEntradasHist([]);
      })
      .finally(() => {
        if (!cancelled) setProductEntradasHistLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preciosDialogOpen, preciosDialogProduct?.id, effectiveSucursalId]);

  const ultimoPrecioCompraConIvaInfo = useMemo(() => {
    if (!preciosDialogProduct) return null;
    const imp = Number(preciosDialogProduct.impuesto) || 16;
    const sorted = [...productEntradasHist].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return tb - ta;
    });
    for (const m of sorted) {
      const pu = m.precioUnitarioCompra;
      if (pu != null && Number.isFinite(pu) && pu >= 0) {
        return {
          monto: roundMoney2(pu * (1 + imp / 100)),
          fecha: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
        };
      }
    }
    return null;
  }, [productEntradasHist, preciosDialogProduct]);

  const precioVentaCatalogoConIva = useMemo(() => {
    if (!preciosDialogProduct) return null;
    const imp = Number(preciosDialogProduct.impuesto) || 16;
    return roundMoney2(preciosDialogProduct.precioVenta * (1 + imp / 100));
  }, [preciosDialogProduct]);

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
    setSkuDrafts((prev) => ({ ...prev, [id]: upperTxt(value) }));
  }, []);

  const commitSkuIfChanged = useCallback(
    async (product: Product) => {
      const raw = upperTxt((skuDrafts[product.id] ?? product.sku).trim());
      if (raw === product.sku) return;
      if (!raw) {
        addToast({ type: 'error', message: 'El SKU no puede estar vacío' });
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
    setAddFormTemplateId('__none__');
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
      claveProdServ: '',
    });
    setPreciosListaStr(emptyPreciosListaStr());
  };

  return (
    <>
    <PageShell
      title="Inventario"
      subtitle="Productos y stock"
      className="min-w-0 max-w-none"
      actionsClassName="md:mt-2"
      actions={
        <Button
          type="button"
          onClick={() => {
            resetForm();
            addSessionLinesRef.current = [];
            setShowAddDialog(true);
          }}
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
            data-wheel-scroll-x="strip"
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

      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-end gap-2 pb-2 sm:mt-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Historial de movimientos de inventario"
          aria-label="Historial de movimientos de inventario"
          className="h-9 w-9 shrink-0 border-blue-600/45 text-blue-800 hover:bg-blue-500/10 hover:text-blue-900 dark:border-amber-500/45 dark:text-amber-200/95 dark:hover:bg-amber-500/15 dark:hover:text-amber-100"
          onClick={() => setMovementsHistoryOpen(true)}
        >
          <Clock className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-blue-600/45 text-blue-800 hover:bg-blue-500/10 hover:text-blue-900 dark:border-amber-500/45 dark:text-amber-200/95 dark:hover:bg-amber-500/15 dark:hover:text-amber-100"
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
                                Editar producto
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openPreciosDialog(product)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                              >
                                <CircleDollarSign className="mr-2 h-4 w-4" />
                                Precios
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
                                Editar / ajustar stock
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openPreciosDialog(product)}
                                className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                              >
                                <CircleDollarSign className="mr-2 h-4 w-4" />
                                Precios
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
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) {
            const snap = addSessionLinesRef.current;
            if (snap.length > 0) {
              setAddSessionSummaryLines([...snap]);
              setAddSessionSummaryOpen(true);
            }
            addSessionLinesRef.current = [];
            resetForm();
          }
        }}
      >
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-h-[92dvh] overflow-auto md:max-w-[min(92vw,64rem)] lg:max-w-[min(92vw,80rem)]">
          <DialogHeader>
            <DialogTitle>Nuevo Producto</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Nombre, SKU, código y descripción se guardan en <span className="font-medium text-slate-800 dark:text-slate-200">MAYÚSCULAS</span> aunque
              escriba en minúsculas.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-2 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.08] p-3 dark:border-cyan-500/30 dark:bg-cyan-950/25">
              <Label>Copiar desde producto existente</Label>
              <Select
                value={addFormTemplateId}
                onValueChange={(v) => {
                  setAddFormTemplateId(v);
                  if (v === '__none__') return;
                  const p = productById.get(v);
                  if (p) applyProductTemplateToAddForm(p);
                }}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Seleccione…" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Ninguno — captura manual
                  </SelectItem>
                  {sortedProductsForTemplate.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-slate-900 dark:text-slate-100">
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-snug text-slate-600 dark:text-slate-400">
                Rellena todos los campos con un artículo del catálogo; cambie SKU, código o existencia si es una
                variante o entrada nueva y guarde.
              </p>
            </div>
            <div className="col-span-2 space-y-2 rounded-lg border border-slate-200/80 bg-slate-200/35 p-3 dark:border-slate-700/60 dark:bg-slate-800/40">
              <Label>Proveedor</Label>
              <Select
                value={formData.proveedor || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, proveedor: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin proveedor
                  </SelectItem>
                  {proveedorSelectOptions.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-snug text-slate-600 dark:text-slate-400">
                Varios artículos del mismo proveedor: elija el proveedor aquí una vez y use{' '}
                <span className="font-medium text-slate-700 dark:text-slate-300">Guardar y otro producto</span> para
                vaciar solo SKU, código y datos del artículo y seguir capturando.
              </p>
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Código de Barras *</Label>
              <Input
                ref={addCodigoBarrasRef}
                value={formData.codigoBarras}
                onChange={(e) => setFormData({ ...formData, codigoBarras: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Descripción</Label>
              <Input
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Unidad SAT (CFDI 4.0) *</Label>
              <Select
                value={formData.unidadMedida}
                onValueChange={(v) => setFormData({ ...formData, unidadMedida: v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Seleccione" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  {SAT_CLAVES_UNIDAD.map((u) => (
                    <SelectItem key={u.clave} value={u.clave} className="text-slate-900 dark:text-slate-100">
                      {u.clave} — {u.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                Clave de unidad del catálogo del SAT (misma que usará la factura).
              </p>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Clave Producto/Servicio SAT *</Label>
              <Input
                inputMode="numeric"
                maxLength={8}
                placeholder="Ej. 31171504"
                value={formData.claveProdServ}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    claveProdServ: normalizeClaveProdServ(e.target.value),
                  })
                }
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                8 dígitos según catálogo c_ClaveProdServ del SAT (facturación).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Precio de venta (sin IVA) *</Label>
              <InventarioCurrencyInput
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={
                  addNumFocus.precioVenta && formData.precioVenta === 0 ? '' : formData.precioVenta
                }
                onFocus={() => setAddNumFocus((f) => ({ ...f, precioVenta: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, precioVenta: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioVenta: 0 }));
                  else {
                    const sinIva = parseFloat(v);
                    setFormData((d) => ({
                      ...d,
                      precioVenta:
                        Number.isFinite(sinIva) && sinIva >= 0 ? roundMoney2(sinIva) : 0,
                    }));
                  }
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                {formData.precioVenta > 0 ? (
                  <>
                    Con IVA ({formData.impuesto}%):{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatMoney(precioVentaSinIvaToConIva(formData.precioVenta, formData.impuesto))}
                    </span>
                    . Se guarda en catálogo el precio sin IVA.
                  </>
                ) : (
                  <>Ingrese el precio base sin impuesto; el sistema calcula el precio con IVA (tasa {formData.impuesto}%).</>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Precio de compra (sin IVA)</Label>
              <InventarioCurrencyInput
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
                  else {
                    const n = parseFloat(v);
                    setFormData((d) => ({
                      ...d,
                      precioCompra: Number.isFinite(n) && n >= 0 ? roundMoney2(n) : 0,
                    }));
                  }
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Mismo criterio que en la factura de compra (base sin impuesto).
              </p>
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
              <Select
                value={formData.categoria || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, categoria: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin categoría
                  </SelectItem>
                  {categoriaSelectOptions.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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
              variant="secondary"
              onClick={() => void handleAddProduct(true)}
              className="border border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Guardar y otro producto
            </Button>
            <Button
              type="button"
              onClick={() => void handleAddProduct(false)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Guardar y cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addSessionSummaryOpen}
        onOpenChange={(o) => {
          setAddSessionSummaryOpen(o);
          if (!o) setAddSessionSummaryLines([]);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,36rem)]">
          <DialogHeader>
            <DialogTitle>Resumen de esta captura</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Productos dados de alta en la sesión que cerró. El total es{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">precio de compra (sin IVA) × stock inicial</span>{' '}
              por línea. Compare con el subtotal sin IVA de su factura del proveedor para comprobar que no falte ningún
              artículo.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(50dvh,22rem)] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-600 dark:text-slate-400">Artículo</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">SKU</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-400">Subtotal s/IVA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addSessionSummaryLines.map((row, i) => (
                  <TableRow key={`${row.sku}-${i}`} className="border-slate-200/80 dark:border-slate-800/60">
                    <TableCell className="max-w-[10rem] text-sm text-slate-800 dark:text-slate-200">
                      <span className="line-clamp-2" title={row.nombre}>
                        {row.nombre}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">{row.sku}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoney(row.subtotalSinIva)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2.5">
            <p className="text-xs text-slate-600 dark:text-slate-400">Total compra (sin IVA)</p>
            <p className="text-xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">
              {formatMoney(
                roundMoney2(addSessionSummaryLines.reduce((s, r) => s + r.subtotalSinIva, 0))
              )}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setAddSessionSummaryOpen(false)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog - Similar al Add */}
      <Dialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) {
            setSelectedProduct(null);
            setEditPreciosSectionOpen(false);
            setStockAdjustment({
              tipo: 'entrada',
              cantidad: 0,
              motivo: '',
              proveedorEntrada: '',
              precioCompraUnit: 0,
            });
          }
        }}
      >
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 max-h-[92dvh] overflow-auto md:max-w-[min(92vw,64rem)] lg:max-w-[min(92vw,80rem)]">
          <DialogHeader>
            <DialogTitle>Editar producto</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Datos del artículo y movimientos de entrada, salida o ajuste de existencias en el mismo lugar. Los textos
              editables se guardan en MAYÚSCULAS.
              {selectedProduct?.nombre ? (
                <span className="mt-1 block font-medium text-slate-800 dark:text-slate-200">
                  {selectedProduct.nombre}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            {/* Mismos campos que Add Dialog */}
            <div className="space-y-2">
              <Label>SKU *</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Código de Barras</Label>
              <Input
                value={formData.codigoBarras}
                onChange={(e) => setFormData({ ...formData, codigoBarras: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Descripción</Label>
              <Input
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: upperTxt(e.target.value) })}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Unidad SAT (CFDI 4.0) *</Label>
              <Select
                value={formData.unidadMedida}
                onValueChange={(v) => setFormData({ ...formData, unidadMedida: v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Seleccione" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  {SAT_CLAVES_UNIDAD.map((u) => (
                    <SelectItem key={u.clave} value={u.clave} className="text-slate-900 dark:text-slate-100">
                      {u.clave} — {u.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Clave Producto/Servicio SAT *</Label>
              <Input
                inputMode="numeric"
                maxLength={8}
                placeholder="Ej. 31171504"
                value={formData.claveProdServ}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    claveProdServ: normalizeClaveProdServ(e.target.value),
                  })
                }
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de venta (sin IVA) *</Label>
              <InventarioCurrencyInput
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={
                  editNumFocus.precioVenta && formData.precioVenta === 0 ? '' : formData.precioVenta
                }
                onFocus={() => setEditNumFocus((f) => ({ ...f, precioVenta: true }))}
                onBlur={() => setEditNumFocus((f) => ({ ...f, precioVenta: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, precioVenta: 0 }));
                  else {
                    const sinIva = parseFloat(v);
                    setFormData((d) => ({
                      ...d,
                      precioVenta:
                        Number.isFinite(sinIva) && sinIva >= 0 ? roundMoney2(sinIva) : 0,
                    }));
                  }
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                {formData.precioVenta > 0 ? (
                  <>
                    Con IVA ({formData.impuesto}%):{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatMoney(precioVentaSinIvaToConIva(formData.precioVenta, formData.impuesto))}
                    </span>
                    . Se guarda en catálogo el precio sin IVA.
                  </>
                ) : (
                  <>Ingrese el precio base sin impuesto; el sistema calcula el precio con IVA (tasa {formData.impuesto}%).</>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Precio de compra (sin IVA)</Label>
              <InventarioCurrencyInput
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
                  else {
                    const n = parseFloat(v);
                    setFormData((d) => ({
                      ...d,
                      precioCompra: Number.isFinite(n) && n >= 0 ? roundMoney2(n) : 0,
                    }));
                  }
                }}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Precio unitario de compra sin impuesto.</p>
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
              <Select
                value={formData.categoria || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, categoria: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin categoría
                  </SelectItem>
                  {categoriaSelectOptions.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select
                value={formData.proveedor || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, proveedor: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin proveedor
                  </SelectItem>
                  {proveedorSelectOptions.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button
              type="button"
              variant={editPreciosSectionOpen ? 'secondary' : 'outline'}
              size="sm"
              className="gap-2 border-slate-300 dark:border-slate-600"
              aria-expanded={editPreciosSectionOpen}
              onClick={() => setEditPreciosSectionOpen((v) => !v)}
            >
              <CircleDollarSign className="h-4 w-4 shrink-0" />
              Precios
            </Button>
            {editPreciosSectionOpen ? (
              <div className="mt-3 space-y-3">
                <p className="text-xs font-medium leading-snug text-slate-600 dark:text-slate-400 [text-wrap:balance]">
                  Precios opcionales por tipo de cliente (sin IVA)
                </p>
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 [text-wrap:pretty]">
                  Si deja vacío, en el POS se usa el precio de venta con el % de la lista en Configuración →
                  Precios{'\u00a0'}por{'\u00a0'}cliente.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {CLIENT_PRICE_LIST_ORDER.map((id) => (
                    <div key={id} className="space-y-1">
                      <Label className="text-xs text-slate-600 dark:text-slate-400">
                        {CLIENT_PRICE_LABELS[id]}
                      </Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={preciosListaStr[id]}
                        onChange={(e) =>
                          setPreciosListaStr((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                        className="h-9 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-3 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Ajustar stock
            </p>
            <div className="rounded-lg bg-slate-200/80 p-4 dark:bg-slate-800/50">
              <p className="text-sm text-slate-600 dark:text-slate-400">Stock actual (en sistema)</p>
              <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-200">
                {selectedProduct?.existencia ?? formData.existencia}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo de ajuste</Label>
                <select
                  value={stockAdjustment.tipo}
                  onChange={(e) => setStockAdjustment({ ...stockAdjustment, tipo: e.target.value })}
                  className="h-10 w-full rounded-md border border-slate-300 bg-slate-200 px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                  <option value="ajuste">Ajuste directo</option>
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
                    if (v === '') setStockAdjustment((st) => ({ ...st, cantidad: 0 }));
                    else setStockAdjustment((st) => ({ ...st, cantidad: parseInt(v, 10) || 0 }));
                  }}
                  className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input
                value={stockAdjustment.motivo}
                onChange={(e) =>
                  setStockAdjustment({ ...stockAdjustment, motivo: upperTxt(e.target.value) })
                }
                placeholder="Ej: Compra a proveedor, merma, inventario físico…"
                className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            {stockAdjustment.tipo === 'entrada' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Select
                    value={
                      stockAdjustment.proveedorEntrada.trim()
                        ? stockAdjustment.proveedorEntrada.trim()
                        : '__none__'
                    }
                    onValueChange={(v) =>
                      setStockAdjustment((st) => ({
                        ...st,
                        proveedorEntrada: v === '__none__' ? '' : v,
                      }))
                    }
                  >
                    <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                      <SelectValue placeholder="Seleccione proveedor" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                    >
                      <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                        Sin especificar
                      </SelectItem>
                      {stockProveedorOptions.map((c) => (
                        <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Precio unitario de compra (sin IVA)</Label>
                  <InventarioCurrencyInput
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={
                      stockPrecioCompraFocus && stockAdjustment.precioCompraUnit === 0
                        ? ''
                        : stockAdjustment.precioCompraUnit === 0
                          ? ''
                          : stockAdjustment.precioCompraUnit
                    }
                    onFocus={() => setStockPrecioCompraFocus(true)}
                    onBlur={() => setStockPrecioCompraFocus(false)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') setStockAdjustment((st) => ({ ...st, precioCompraUnit: 0 }));
                      else
                        setStockAdjustment((st) => ({
                          ...st,
                          precioCompraUnit: parseFloat(v) || 0,
                        }));
                    }}
                    className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-500">
                    Opcional (sin IVA). Se guarda en el historial de Configuración → Abasto.
                  </p>
                </div>
              </div>
            ) : null}

            <Button
              type="button"
              variant="secondary"
              className="w-full border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:w-auto"
              onClick={() => void handleStockAdjustment()}
            >
              Aplicar ajuste de stock
            </Button>
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

      <Dialog
        open={preciosDialogOpen}
        onOpenChange={(open) => {
          setPreciosDialogOpen(open);
          if (!open) setPreciosDialogProduct(null);
        }}
      >
        <DialogContent className="flex max-h-[min(92dvh,44rem)] w-full min-w-0 max-w-[min(96vw,44rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-800/80">
            <DialogTitle>Precios e historial de entradas</DialogTitle>
            {preciosDialogProduct ? (
              <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{preciosDialogProduct.nombre}</span>
                <span className="text-slate-500"> · SKU {preciosDialogProduct.sku}</span>
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            <div className="mb-4 space-y-3 rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-3 dark:border-cyan-500/30 dark:bg-cyan-500/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                Referencia de precios (con IVA)
              </p>
              {precioVentaCatalogoConIva != null ? (
                <div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Precio de venta en catálogo <span className="font-medium">(con IVA)</span>
                  </p>
                  <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(precioVentaCatalogoConIva)}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-500">
                    Calculado desde el precio sin IVA del producto y su tasa ({preciosDialogProduct?.impuesto ?? 16}%).
                  </p>
                </div>
              ) : null}
              {ultimoPrecioCompraConIvaInfo ? (
                <div className="border-t border-cyan-500/20 pt-3 dark:border-cyan-500/25">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Último precio de compra registrado en entradas <span className="font-medium">(con IVA)</span>
                  </p>
                  <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(ultimoPrecioCompraConIvaInfo.monto)}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-500">
                    Según la entrada más reciente con precio unitario de compra (
                    {formatInAppTimezone(ultimoPrecioCompraConIvaInfo.fecha, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    ). El unitario en tabla sigue mostrándose sin IVA.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  No hay entradas con precio de compra capturado; cuando registre una, aquí aparecerá el último importe{' '}
                  <span className="font-medium">con IVA</span>.
                </p>
              )}
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500">
                Para precios por lista de cliente (regular, técnico, mayoreo…), use{' '}
                <span className="font-medium text-slate-700 dark:text-slate-300">Editar producto</span> → sección
                Precios.
              </p>
            </div>

            <div className="mt-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Historial de llegadas (entradas / compras)
              </p>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-500">
                Cantidad recibida, precio unitario de compra (sin IVA) y proveedor cuando se registraron al dar de
                alta mercancía o ajustar stock.
              </p>
              {productEntradasHistLoading ? (
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                  ))}
                </div>
              ) : productEntradasHist.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-200/40 px-3 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                  No hay entradas registradas para este artículo (o aún no se capturó proveedor / precio en las
                  entradas).
                </p>
              ) : (
                <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800/70">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-600 dark:text-slate-400">Fecha</TableHead>
                        <TableHead className="text-right text-slate-600 dark:text-slate-400">Cantidad</TableHead>
                        <TableHead className="text-right text-slate-600 dark:text-slate-400">
                          P. unit. compra
                        </TableHead>
                        <TableHead className="text-slate-600 dark:text-slate-400">Proveedor</TableHead>
                        <TableHead className="text-slate-600 dark:text-slate-400">Tipo</TableHead>
                        <TableHead className="min-w-[6rem] text-slate-600 dark:text-slate-400">Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productEntradasHist.map((mov) => {
                        const when = mov.createdAt instanceof Date ? mov.createdAt : new Date(mov.createdAt);
                        const pu = mov.precioUnitarioCompra;
                        return (
                          <TableRow
                            key={mov.id}
                            className="border-slate-200 dark:border-slate-800/80 hover:bg-slate-200/40 dark:hover:bg-slate-800/30"
                          >
                            <TableCell className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                              {formatInAppTimezone(when, { dateStyle: 'short', timeStyle: 'short' })}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums text-cyan-600 dark:text-cyan-400">
                              +{mov.cantidad}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-slate-700 dark:text-slate-300">
                              {pu != null && Number.isFinite(pu) ? formatMoney(pu) : '—'}
                            </TableCell>
                            <TableCell className="max-w-[8rem] text-xs text-slate-700 dark:text-slate-300">
                              {mov.proveedor?.trim() || '—'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                              {tipoMovimientoLabel(mov.tipo)}
                            </TableCell>
                            <TableCell className="max-w-[10rem] text-xs text-slate-600 dark:text-slate-400">
                              <span className="line-clamp-2">{mov.motivo?.trim() || '—'}</span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreciosDialogOpen(false);
                setPreciosDialogProduct(null);
              }}
              className="border-slate-300 dark:border-slate-600"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movementsHistoryOpen} onOpenChange={setMovementsHistoryOpen}>
        <DialogContent className="flex max-h-[min(92dvh,40rem)] w-full min-w-0 max-w-[min(96vw,48rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-800/80">
            <DialogTitle>Historial de movimientos</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Movimientos de existencias (entradas, salidas, ventas) y eventos de catálogo: altas, bajas y cambios de
              precios o datos del artículo. Hasta 500 registros más recientes.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {inventoryMovementsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                ))}
              </div>
            ) : inventoryMovements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 dark:text-slate-500">
                <Clock className="mb-2 h-10 w-10 opacity-50" />
                <p className="text-sm">No hay movimientos registrados</p>
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800/70">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                      <TableHead className="text-slate-600 dark:text-slate-400">Artículo</TableHead>
                      <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                        Antes
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                        Después
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                        Fecha y hora
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Tipo</TableHead>
                      <TableHead className="min-w-[6rem] text-slate-600 dark:text-slate-400">Proveedor</TableHead>
                      <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                        P. compra
                      </TableHead>
                      <TableHead className="min-w-[8rem] text-slate-600 dark:text-slate-400">Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryMovements.map((mov) => {
                      const prod = productById.get(mov.productId);
                      const nombre =
                        prod?.nombre?.trim() ||
                        mov.nombreRegistro?.trim() ||
                        `Producto (${mov.productId.slice(0, 8)}…)`;
                      const skuShown = prod?.sku || mov.skuRegistro;
                      const when = mov.createdAt instanceof Date ? mov.createdAt : new Date(mov.createdAt);
                      const motivo = mov.motivo?.trim() || '—';
                      const pu = mov.precioUnitarioCompra;
                      const cat = isCatalogInventoryMovement(mov.tipo);
                      return (
                        <TableRow
                          key={mov.id}
                          className="border-slate-200 dark:border-slate-800/80 hover:bg-slate-200/40 dark:hover:bg-slate-800/30"
                        >
                          <TableCell className="max-w-[12rem]">
                            <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                              {nombre}
                            </span>
                            {skuShown ? (
                              <span className="block truncate text-[11px] text-slate-500 dark:text-slate-500">
                                SKU {skuShown}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-800 dark:text-slate-200">
                            {cat ? '—' : mov.cantidadAnterior}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums font-medium text-cyan-600 dark:text-cyan-400">
                            {cat ? '—' : mov.cantidadNueva}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                            {formatInAppTimezone(when, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                            {tipoMovimientoLabel(mov.tipo)}
                          </TableCell>
                          <TableCell className="max-w-[6rem] text-xs text-slate-700 dark:text-slate-300">
                            {cat ? '—' : mov.proveedor?.trim() || '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-slate-700 dark:text-slate-300">
                            {cat ? '—' : pu != null && Number.isFinite(pu) ? formatMoney(pu) : '—'}
                          </TableCell>
                          <TableCell
                            className="max-w-[14rem] text-xs text-slate-700 dark:text-slate-300"
                            title={motivo !== '—' ? motivo : undefined}
                          >
                            <span className={cat ? 'line-clamp-4 whitespace-pre-wrap' : 'line-clamp-2'}>
                              {motivo}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 flex-col gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800/80 sm:flex-row sm:items-center sm:justify-between">
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                className="w-full border-red-500/40 text-red-700 hover:bg-red-500/10 dark:border-red-500/35 dark:text-red-300 dark:hover:bg-red-950/40 sm:w-auto"
                disabled={inventoryMovementsLoading || inventoryMovements.length === 0}
                onClick={() => setClearMovementsConfirmOpen(true)}
              >
                Vaciar historial
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full border-slate-300 dark:border-slate-600 sm:ml-auto sm:w-auto"
              onClick={() => setMovementsHistoryOpen(false)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearMovementsConfirmOpen} onOpenChange={setClearMovementsConfirmOpen}>
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Vaciar historial de movimientos</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              Se eliminarán todos los registros: movimientos de existencias y el historial de altas, bajas y ediciones
              de catálogo. No se puede deshacer. El stock actual y los productos no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearingMovements}
              onClick={(e) => {
                e.preventDefault();
                void handleClearInventoryMovements();
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {clearingMovements ? 'Borrando…' : 'Vaciar todo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
