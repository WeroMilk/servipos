import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Search,
  Edit2,
  Trash2,
  Package,
  AlertTriangle,
  Barcode,
  TrendingUp,
  Layers,
  MoreHorizontal,
  Truck,
  Clock,
  CircleDollarSign,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Download,
  MapPin,
  History,
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
  useEffectiveSucursalId,
  usePendingIncomingTransfers,
  useInventoryMovementsHistory,
} from '@/hooks';
import { useAppStore, useAuthStore, useInventoryListsStore } from '@/stores';
import { setInventarioHeaderBridge, clearInventarioHeaderBridge } from '@/stores/inventarioHeaderStore';
import type { InventoryMovement, Product, Sucursal } from '@/types';
import { productEsServicio } from '@/lib/productServicio';
import { useClientPriceListCatalog } from '@/hooks/useClientPriceListCatalog';
import {
  type ClientPriceListId,
  POS_EDIT_UNIT_PRICE_PIN,
} from '@/lib/clientPriceLists';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { clearAllInventoryMovementsLocal, getInventoryMovementsByProductId } from '@/db/database';
import { deleteAllInventoryMovementsFirestore } from '@/lib/firestore/inventoryMovementsFirestore';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { getSucursalStateDocOnce } from '@/lib/firestore/stateDocsFirestore';
import { confirmIncomingStoreTransfer } from '@/lib/firestore/storeTransfersFirestore';
import { cn, formatMoney } from '@/lib/utils';
import { userIsGerenteOrAdmin } from '@/lib/userPermissions';
import { getProductPrecioPublicoRegular, deriveListaPrecioStorageStringsFromPrecioVenta } from '@/lib/productListPricing';
import { getClientPriceListCatalogFromStore } from '@/lib/clientPriceListCatalog';
import { parsePrecioNumberFromFirestore } from '@/lib/precioListaNorm';
import {
  SAT_CLAVES_UNIDAD,
  DEFAULT_CLAVE_PROD_SERV,
  normalizeClaveProdServ,
  normalizeClaveUnidadSat,
  isValidClaveProdServSat,
  resolveClaveProdServ,
  satUnidadLlegadaLabels,
  parseCantidadLlegadaSat,
  parseExistenciaInventarioForm,
} from '@/lib/satCatalog';
import { PageShell } from '@/components/ui-custom/PageShell';
import { printThermalLowStockReport } from '@/lib/printTicket';
import { tipoMovimientoLabel } from '@/lib/inventoryMovementLabels';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { isMovimientoLlegadaMercancia } from '@/lib/inventoryAbasto';
import { downloadInventarioCompleto, downloadInventarioStockBajo } from '@/lib/inventoryExport';
import { getUbicacionesProducto, MUEBLE_SLOTS, resolveUbicacionesProducto } from '@/data/ubicacionesMuebleA';
import { UbicacionFisicaNombre } from '@/components/products/UbicacionFisicaNombre';
import { buildProductSearchIndex, searchProductIndex } from '@/lib/productSearchIndex';
import { effectiveListaPreciosIncluyenIva, defaultListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';
import {
  buildProveedorNombrePorLinea,
  formatProveedorHistorialLineaResuelto,
  lookupProveedorCodigo,
  normalizeProveedorNombreGuardado,
  proveedorSelectItemLabel,
} from '@/lib/proveedoresCatalog';

type InventoryMode = 'productos' | 'stock' | 'valor' | 'codigos';

type InventorySortKey = 'nombre' | 'sku' | 'categoria' | 'precio' | 'existencia';

/** Evita renderizar miles de filas DOM a la vez (principal coste de la pantalla). */
const INVENTORY_PAGE_SIZE = 150;

function InventorySortLabelButton({
  sortKey,
  label,
  inventorySort,
  onSort,
}: {
  sortKey: InventorySortKey;
  label: string;
  inventorySort: { key: InventorySortKey; dir: 'asc' | 'desc' };
  onSort: (key: InventorySortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        '-mx-0.5 flex w-fit max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 text-left text-[10px] uppercase tracking-wide transition-colors',
        inventorySort.key === sortKey
          ? 'font-semibold text-brand dark:text-brand'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
      )}
      aria-pressed={inventorySort.key === sortKey}
    >
      {label}
      {inventorySort.key === sortKey ?
        inventorySort.dir === 'asc' ?
          <ArrowUp className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
        : <ArrowDown className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
      : null}
    </button>
  );
}

function compareInventoryProducts(
  a: Product,
  b: Product,
  key: InventorySortKey,
  dir: 'asc' | 'desc'
): number {
  const mul = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  if (key === 'nombre') {
    cmp = String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es', { sensitivity: 'base' });
  } else if (key === 'sku') {
    cmp = String(a.sku ?? '').localeCompare(String(b.sku ?? ''), 'es', { sensitivity: 'base', numeric: true });
  } else if (key === 'precio') {
    cmp = getProductPrecioPublicoRegular(a) - getProductPrecioPublicoRegular(b);
  } else if (key === 'existencia') {
    cmp = (Number(a.existencia) || 0) - (Number(b.existencia) || 0);
  } else {
    const ca = (a.categoria ?? '').trim() || 'Sin categoría';
    const cb = (b.categoria ?? '').trim() || 'Sin categoría';
    cmp = ca.localeCompare(cb, 'es', { sensitivity: 'base' });
  }
  if (cmp !== 0) return mul * cmp;
  return mul * String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es', { sensitivity: 'base' });
}

/**
 * Stock bajo: sin existencia; existencia &lt; 15% del mínimo (si hay mínimo &gt; 0);
 * o existencia en o por debajo del mínimo configurado.
 */
function isStockBajo(p: { existencia: number; existenciaMinima: number; esServicio?: boolean; categoria?: string }): boolean {
  if (productEsServicio(p)) return false;
  if (p.existencia <= 0) return true;
  if (p.existenciaMinima > 0 && p.existencia / p.existenciaMinima < 0.15) return true;
  return p.existencia <= p.existenciaMinima;
}

function isCatalogInventoryMovement(t: InventoryMovement['tipo']): boolean {
  return t === 'producto_alta' || t === 'producto_baja' || t === 'producto_edicion';
}

function InventarioCurrencyInput({
  className,
  type = 'text',
  inputMode = 'decimal',
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-sm font-medium text-slate-600 dark:text-slate-400"
        aria-hidden
      >
        $
      </span>
      <Input type={type} inputMode={inputMode} {...props} className={cn('pl-7', className)} />
    </div>
  );
}

function emptyPreciosListaStr(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const id of getClientPriceListCatalogFromStore().ids) o[id] = '';
  return o;
}

function parsePreciosListaForm(
  strMap: Record<string, string>
): Product['preciosPorListaCliente'] | undefined {
  const out: Partial<Record<ClientPriceListId, number>> = {};
  for (const id of getClientPriceListCatalogFromStore().ids) {
    const t = (strMap[id] ?? '').trim();
    if (t === '') continue;
    const n = parsePrecioNumberFromFirestore(t);
    if (Number.isFinite(n) && n >= 0) out[id] = roundMoney2(n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Mismo criterio que import CSV / Firestore: coma o punto decimal, miles. */
function parseMoneyInput(raw: string): number {
  const n = parsePrecioNumberFromFirestore(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney2(n);
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Catálogo guarda `precioVenta` sin IVA; en formulario el usuario captura sin IVA y se muestra el equivalente con IVA. */
function precioVentaSinIvaToConIva(sinIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  return roundMoney2(sinIva * (1 + imp / 100));
}

function precioConIvaToSinIva(conIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  if (imp <= 0) return roundMoney2(conIva);
  return roundMoney2(conIva / (1 + imp / 100));
}

type InventarioPrecioIvaMode = 'sin' | 'con';

/** Permite seguir escribiendo decimales (ej. "12." o "12,5") sin que el input pierda el separador. */
function isIncompleteMoneyInput(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && /[.,]$/.test(t);
}

function filterMoneyTypingInput(raw: string): string {
  let s = raw.replace(/[^\d.,]/g, '');
  const sepIdx = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (sepIdx >= 0) {
    s = s.slice(0, sepIdx + 1) + s.slice(sepIdx + 1).replace(/[.,]/g, '');
  }
  return s;
}

type InventarioStoredMoneyInputProps = Omit<
  ComponentProps<typeof InventarioCurrencyInput>,
  'value' | 'onChange'
> & {
  storedSinIva: number;
  onStoredSinIvaChange: (n: number) => void;
  ivaMode: InventarioPrecioIvaMode;
  impuestoPct: number;
};

function InventarioStoredMoneyInput({
  storedSinIva,
  onStoredSinIvaChange,
  ivaMode,
  impuestoPct,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...rest
}: InventarioStoredMoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const showConIva = ivaMode === 'con';

  const formatStoredForDisplay = (stored: number): string => {
    if (stored === 0) return '';
    const n = showConIva ? precioVentaSinIvaToConIva(stored, impuestoPct) : stored;
    return String(n);
  };

  const parseDisplayToStored = (displayNum: number): number =>
    showConIva ? precioConIvaToSinIva(displayNum, impuestoPct) : displayNum;

  const blurredValue = formatStoredForDisplay(storedSinIva);
  const value = draft !== null ? draft : blurredValue;

  const syncStoredFromDraft = (raw: string) => {
    if (raw.trim() === '') {
      onStoredSinIvaChange(0);
      return;
    }
    if (isIncompleteMoneyInput(raw)) return;
    onStoredSinIvaChange(parseDisplayToStored(parseMoneyInput(raw)));
  };

  return (
    <InventarioCurrencyInput
      {...rest}
      value={value}
      onFocus={(e) => {
        setDraft(blurredValue);
        onFocusProp?.(e);
      }}
      onBlur={(e) => {
        const raw = draft ?? blurredValue;
        if (raw.trim() === '') onStoredSinIvaChange(0);
        else onStoredSinIvaChange(parseDisplayToStored(parseMoneyInput(raw)));
        setDraft(null);
        onBlurProp?.(e);
      }}
      onChange={(e) => {
        const v = filterMoneyTypingInput(e.target.value);
        setDraft(v);
        syncStoredFromDraft(v);
      }}
    />
  );
}

/**
 * `preciosPorListaCliente` se guarda con o sin IVA según el producto/config; el toggle solo cambia cómo se captura en pantalla.
 */
function convertListaPrecioStrForDisplay(
  storageStr: string,
  storageIncluyeIva: boolean,
  modoDisplayConIva: boolean,
  impuestoPct: number
): string {
  const t = (storageStr ?? '').trim();
  if (t === '') return '';
  const n = parsePrecioNumberFromFirestore(t);
  if (!Number.isFinite(n) || n < 0) return storageStr;
  const sinIva = storageIncluyeIva ? precioConIvaToSinIva(n, impuestoPct) : roundMoney2(n);
  const conIva = storageIncluyeIva ? roundMoney2(n) : precioVentaSinIvaToConIva(n, impuestoPct);
  const display = modoDisplayConIva ? conIva : sinIva;
  if (!Number.isFinite(display) || display <= 0) return '';
  return roundMoney2(display).toFixed(2);
}

function convertListaPrecioInputToStorage(
  inputStr: string,
  storageIncluyeIva: boolean,
  modoDisplayConIva: boolean,
  impuestoPct: number
): string {
  const t = (inputStr ?? '').trim();
  if (t === '') return '';
  const n = parsePrecioNumberFromFirestore(t);
  if (!Number.isFinite(n) || n < 0) return t;
  const displaySinIva = modoDisplayConIva ? precioConIvaToSinIva(n, impuestoPct) : roundMoney2(n);
  const displayConIva = modoDisplayConIva ? roundMoney2(n) : precioVentaSinIvaToConIva(n, impuestoPct);
  const storage = storageIncluyeIva ? displayConIva : displaySinIva;
  const rounded = roundMoney2(storage);
  return rounded > 0 ? String(rounded) : '';
}

/** Solo dígitos y separadores; evita letras mientras se edita el precio. */
function sanitizeListaPrecioDraft(raw: string): string {
  return raw.replace(/[^\d.,]/g, '');
}

/** Une borradores de campos enfocados con el mapa guardado (p. ej. al guardar sin haber hecho blur). */
function mergeListasPrecioDraftIntoStorage(
  storage: Record<ClientPriceListId, string>,
  draft: Partial<Record<ClientPriceListId, string>>,
  storageIncluyeIva: boolean,
  modoDisplayConIva: boolean,
  impuestoPct: number
): Record<ClientPriceListId, string> {
  const next = { ...storage };
  for (const id of getClientPriceListCatalogFromStore().ids) {
    const raw = draft[id];
    if (raw !== undefined) {
      next[id] = convertListaPrecioInputToStorage(
        raw,
        storageIncluyeIva,
        modoDisplayConIva,
        impuestoPct
      );
    }
  }
  return next;
}

function InventarioPrecioIvaModeToggle({
  value,
  onChange,
  disabled,
  className,
}: {
  value: InventarioPrecioIvaMode;
  onChange: (v: InventarioPrecioIvaMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Ver y capturar precios con IVA o sin IVA"
      className={cn(
        'inline-flex shrink-0 rounded-md border border-slate-300 bg-slate-200/80 p-0.5 dark:border-slate-600 dark:bg-slate-800/80',
        className
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('sin')}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'sin'
            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        )}
        aria-pressed={value === 'sin'}
      >
        Sin IVA
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('con')}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'con'
            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        )}
        aria-pressed={value === 'con'}
      >
        Con IVA
      </button>
    </div>
  );
}

/** Texto de catálogo en mayúsculas aunque el usuario escriba en minúsculas. */
function upperTxt(s: string): string {
  return s.toLocaleUpperCase('es');
}

/** No mostrar línea secundaria bajo el nombre si la descripción es vacía o placeholder de import (p. ej. "0"). */
function hasInventoryDescripcionVisible(descripcion: string | undefined | null): boolean {
  const t = (descripcion ?? '').trim();
  return t !== '' && t !== '0';
}

function InventoryProductActions({
  editLabel = 'Editar / ajustar stock',
  onEdit,
  onPrecios,
  onDelete,
}: {
  editLabel?: string;
  onEdit: () => void;
  onPrecios: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-slate-600 dark:text-slate-400"
          aria-label="Acciones del producto"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
      >
        <DropdownMenuItem
          onClick={onEdit}
          className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
        >
          <Edit2 className="mr-2 h-4 w-4" />
          {editLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onPrecios}
          className="text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
        >
          <CircleDollarSign className="mr-2 h-4 w-4" />
          Precios
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AddSessionLine = { nombre: string; sku: string; subtotalSinIva: number };

export function Inventario() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const consumedEditFromMissions = useRef<string | null>(null);
  const {
    products,
    loading,
    error: productsError,
    addProduct,
    editProduct,
    removeProduct,
    removeAllServicioProducts,
    adjustStock,
  } = useProducts();
  const priceListCatalog = useClientPriceListCatalog();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const setListasPrecioExtraInventario = useInventoryListsStore((s) => s.setListasPrecioExtra);
  const { addToast } = useAppStore();
  const { user } = useAuthStore();
  const { pendingIncoming } = usePendingIncomingTransfers();
  const [sucursalesCat, setSucursalesCat] = useState<Sucursal[]>([]);
  const [confirmingTransferId, setConfirmingTransferId] = useState<string | null>(null);

  useEffect(() => subscribeSucursales(setSucursalesCat), []);

  useEffect(() => {
    if (!effectiveSucursalId) return;
    void getSucursalStateDocOnce<{
      categorias?: string[];
      proveedores?: string[];
      listasPrecioExtra?: string[];
    }>(effectiveSucursalId, 'inventory_lists').then((doc) => {
      if (Array.isArray(doc?.listasPrecioExtra)) {
        setListasPrecioExtraInventario(doc.listasPrecioExtra);
      }
    });
  }, [effectiveSucursalId, setListasPrecioExtraInventario]);

  const serviciosPurgeRef = useRef(false);

  /** Purga única de productos servicio (categoría SERVICIOS / esServicio). */
  useEffect(() => {
    const PURGE_KEY = 'servipos:servicios-purged-v1';
    if (loading || serviciosPurgeRef.current) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(PURGE_KEY)) return;

    const servicios = products.filter((p) => p.activo !== false && productEsServicio(p));
    if (servicios.length === 0) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(PURGE_KEY, '1');
      return;
    }

    serviciosPurgeRef.current = true;
    void (async () => {
      try {
        const n = await removeAllServicioProducts();
        if (typeof localStorage !== 'undefined') localStorage.setItem(PURGE_KEY, '1');
        if (n > 0) {
          addToast({
            type: 'success',
            message: `Se eliminaron ${n} productos de servicios del catálogo.`,
          });
        }
      } catch (err) {
        serviciosPurgeRef.current = false;
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'No se pudieron eliminar los servicios',
        });
      }
    })();
  }, [loading, products, removeAllServicioProducts, addToast]);

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
        addToast({
          type: 'success',
          message: 'Traspaso recibido; el stock de esta tienda se actualizó.',
        });
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
  const [debouncedInventorySearch, setDebouncedInventorySearch] = useState('');
  const [inventorySort, setInventorySort] = useState<{ key: InventorySortKey; dir: 'asc' | 'desc' }>({
    key: 'nombre',
    dir: 'asc',
  });
  const [inventoryListPage, setInventoryListPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [ubicacionDialogProduct, setUbicacionDialogProduct] = useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  /** Confirmación al cambiar estante: eliminar ubicaciones anteriores (mapa + form). */
  const [ubicacionReplaceConfirm, setUbicacionReplaceConfirm] = useState<{
    next: string;
    previousSlots: string[];
  } | null>(null);
  const ubicacionDialogSlots = useMemo(() => {
    if (!ubicacionDialogProduct) return [] as string[];
    return resolveUbicacionesProducto(ubicacionDialogProduct);
  }, [ubicacionDialogProduct]);
  const [stockAdjustment, setStockAdjustment] = useState({
    tipo: 'entrada',
    cantidad: 0,
    motivo: '',
    proveedorEntrada: '',
    precioCompraUnit: 0,
  });
  const [stockQtyFocus, setStockQtyFocus] = useState(false);
  const addCodigoBarrasRef = useRef<HTMLInputElement>(null);
  const addSessionLinesRef = useRef<AddSessionLine[]>([]);
  const [addSessionSummaryOpen, setAddSessionSummaryOpen] = useState(false);
  const [addSessionSummaryLines, setAddSessionSummaryLines] = useState<AddSessionLine[]>([]);
  /** Al enfocar, ocultar 0 para escribir sin borrar; al salir vacío queda 0 en estado. */
  const [addNumFocus, setAddNumFocus] = useState({
    existencia: false,
    existenciaMinima: false,
  });
  const [editNumFocus, setEditNumFocus] = useState({
    existenciaMinima: false,
  });
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>('productos');

  const setInventoryModeWithDefaultSort = useCallback((mode: InventoryMode) => {
    setInventoryMode(mode);
    if (mode === 'valor') {
      setInventorySort({ key: 'precio', dir: 'desc' });
    }
  }, []);

  const [exportingInventario, setExportingInventario] = useState(false);
  const [skuDrafts, setSkuDrafts] = useState<Record<string, string>>({});
  const [movementsHistoryOpen, setMovementsHistoryOpen] = useState(false);
  const [clearMovementsConfirmOpen, setClearMovementsConfirmOpen] = useState(false);
  const [clearingMovements, setClearingMovements] = useState(false);
  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [preciosDialogOpen, setPreciosDialogOpen] = useState(false);
  const [preciosDialogProduct, setPreciosDialogProduct] = useState<Product | null>(null);
  const [preciosDialogListaStr, setPreciosDialogListaStr] = useState(emptyPreciosListaStr);
  const [preciosDialogSaving, setPreciosDialogSaving] = useState(false);
  const [productEntradasHist, setProductEntradasHist] = useState<InventoryMovement[]>([]);
  const [productEntradasHistLoading, setProductEntradasHistLoading] = useState(false);
  const [editPreciosSectionOpen, setEditPreciosSectionOpen] = useState(false);
  const [editDialogView, setEditDialogView] = useState<'edit' | 'historial'>('edit');
  const [productHistorialMovs, setProductHistorialMovs] = useState<InventoryMovement[]>([]);
  const [productHistorialLoading, setProductHistorialLoading] = useState(false);
  const [addPrecioIvaMode, setAddPrecioIvaMode] = useState<InventarioPrecioIvaMode>('sin');
  const [editPrecioIvaMode, setEditPrecioIvaMode] = useState<InventarioPrecioIvaMode>('sin');
  const [editPreciosListaIvaMode, setEditPreciosListaIvaMode] = useState<InventarioPrecioIvaMode>('sin');
  const [preciosDialogListaIvaMode, setPreciosDialogListaIvaMode] = useState<InventarioPrecioIvaMode>('sin');
  const [inventoryBootstrapping, setInventoryBootstrapping] = useState(true);

  const isAdmin = user?.role === 'admin';
  const canBypassInventoryEditPin = userIsGerenteOrAdmin(user);
  const [managerAuthOpen, setManagerAuthOpen] = useState(false);
  const [managerAuthPin, setManagerAuthPin] = useState('');
  const managerAuthPinRef = useRef<HTMLInputElement>(null);
  const managerAuthPendingRef = useRef<(() => void) | null>(null);
  const managerAuthCancelRef = useRef<(() => void) | null>(null);

  const closeManagerAuthDialog = useCallback(() => {
    const onCancel = managerAuthCancelRef.current;
    managerAuthCancelRef.current = null;
    managerAuthPendingRef.current = null;
    setManagerAuthOpen(false);
    setManagerAuthPin('');
    onCancel?.();
  }, []);

  const requestManagerAuth = useCallback(
    (action: () => void, onCancel?: () => void) => {
      if (canBypassInventoryEditPin) {
        action();
        return;
      }
      managerAuthPendingRef.current = action;
      managerAuthCancelRef.current = onCancel ?? null;
      setManagerAuthPin('');
      setManagerAuthOpen(true);
    },
    [canBypassInventoryEditPin]
  );

  const confirmManagerAuthPin = useCallback(() => {
    if (managerAuthPin.trim() === POS_EDIT_UNIT_PRICE_PIN) {
      const action = managerAuthPendingRef.current;
      managerAuthPendingRef.current = null;
      managerAuthCancelRef.current = null;
      setManagerAuthOpen(false);
      setManagerAuthPin('');
      action?.();
      return;
    }
    addToast({ type: 'error', message: 'Contraseña incorrecta' });
  }, [managerAuthPin, addToast]);

  useEffect(() => {
    if (!managerAuthOpen) return;
    const t = window.setTimeout(() => managerAuthPinRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [managerAuthOpen]);

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

  const editListaStorageIncluyeIva = useMemo(
    () => (selectedProduct ? effectiveListaPreciosIncluyenIva(selectedProduct) : true),
    [selectedProduct]
  );

  const cascadeListasFromPrecioVenta = useCallback(
    (precioVentaSinIva: number, impuestoPct: number, storageIncluyeIva: boolean) => {
      const derived = deriveListaPrecioStorageStringsFromPrecioVenta(
        precioVentaSinIva,
        storageIncluyeIva,
        impuestoPct
      );
      setPreciosListaStr((prev) => ({ ...prev, regular: derived.regular }));
      setListasPrecioMainDraft({});
    },
    []
  );

  const preciosDialogListaStorageIncluyeIva = useMemo(
    () => (preciosDialogProduct ? effectiveListaPreciosIncluyenIva(preciosDialogProduct) : true),
    [preciosDialogProduct]
  );

  useEffect(() => {
    setListasPrecioMainDraft({});
  }, [editPreciosListaIvaMode]);

  useEffect(() => {
    setListasPrecioDialogDraft({});
  }, [preciosDialogListaIvaMode]);

  const [addTemplateComboOpen, setAddTemplateComboOpen] = useState(false);
  const [addTemplateSearch, setAddTemplateSearch] = useState('');

  const addTemplateMatches = useMemo(() => {
    if (!showAddDialog) return [];
    const q = addTemplateSearch.trim().toLowerCase();
    if (q.length < 1) return [];
    const rows = products.filter((p) => {
      const n = (p.nombre || '').toLowerCase();
      const s = (p.sku || '').toLowerCase();
      const cb = (p.codigoBarras || '').toLowerCase();
      return n.includes(q) || s.includes(q) || cb.includes(q);
    });
    rows.sort((a, b) =>
      (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
    );
    return rows.slice(0, 100);
  }, [products, addTemplateSearch, showAddDialog]);

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
    claveProdServ: DEFAULT_CLAVE_PROD_SERV,
    ubicacionFisica: '',
  });

  const [preciosListaStr, setPreciosListaStr] = useState(emptyPreciosListaStr);
  /** Borrador por campo mientras hay foco (evita formatear a 2 decimales en cada tecla y romper "100"). */
  const [listasPrecioMainDraft, setListasPrecioMainDraft] = useState<
    Partial<Record<ClientPriceListId, string>>
  >({});
  const [listasPrecioDialogDraft, setListasPrecioDialogDraft] = useState<
    Partial<Record<ClientPriceListId, string>>
  >({});
  const [addFormTemplateId, setAddFormTemplateId] = useState<string>('__none__');
  const [addProveedorSelectKey, setAddProveedorSelectKey] = useState(0);
  const [addProveedorFilter, setAddProveedorFilter] = useState('');
  const [editProveedorFilter, setEditProveedorFilter] = useState('');
  const [stockProveedorFilter, setStockProveedorFilter] = useState('');
  const [addTemplateLlegadaOpen, setAddTemplateLlegadaOpen] = useState(false);
  const [addTemplateLlegadaProduct, setAddTemplateLlegadaProduct] = useState<Product | null>(null);
  const [addTemplateLlegadaQtyStr, setAddTemplateLlegadaQtyStr] = useState('');
  const categoriasLista = useInventoryListsStore((s) => s.categorias);
  const proveedoresLista = useInventoryListsStore((s) => s.proveedores);

  const categoriaSelectOptions = useMemo(() => {
    const s = new Set(categoriasLista);
    if (formData.categoria && !s.has(formData.categoria)) {
      return [formData.categoria, ...categoriasLista];
    }
    return categoriasLista;
  }, [categoriasLista, formData.categoria]);

  const proveedorNombreMapForm = useMemo(() => {
    const m = buildProveedorNombrePorLinea(proveedoresLista);
    if (formData.proveedor?.trim()) {
      const n = normalizeProveedorNombreGuardado(formData.proveedor);
      if (n && !m.has(n)) m.set(n, { codigo: '', nombre: n });
    }
    return m;
  }, [proveedoresLista, formData.proveedor]);

  const proveedorNombresSortedForm = useMemo(
    () => [...proveedorNombreMapForm.keys()].sort((a, b) => a.localeCompare(b, 'es')),
    [proveedorNombreMapForm]
  );

  const proveedorOptionsForAddSelect = useMemo(() => {
    const q = addProveedorFilter.trim().toLowerCase();
    let list = proveedorNombresSortedForm;
    if (q.length > 0) {
      list = proveedorNombresSortedForm.filter((nombre) => {
        const row = proveedorNombreMapForm.get(nombre);
        const cod = (row?.codigo ?? '').toLowerCase();
        return nombre.toLowerCase().includes(q) || cod.includes(q);
      });
    }
    const sel = formData.proveedor?.trim() ? normalizeProveedorNombreGuardado(formData.proveedor) : '';
    if (sel && !list.includes(sel)) {
      return [sel, ...list];
    }
    return list;
  }, [proveedorNombresSortedForm, proveedorNombreMapForm, addProveedorFilter, formData.proveedor]);

  const proveedorOptionsForEditSelect = useMemo(() => {
    const q = editProveedorFilter.trim().toLowerCase();
    let list = proveedorNombresSortedForm;
    if (q.length > 0) {
      list = proveedorNombresSortedForm.filter((nombre) => {
        const row = proveedorNombreMapForm.get(nombre);
        const cod = (row?.codigo ?? '').toLowerCase();
        return nombre.toLowerCase().includes(q) || cod.includes(q);
      });
    }
    const sel = formData.proveedor?.trim() ? normalizeProveedorNombreGuardado(formData.proveedor) : '';
    if (sel && !list.includes(sel)) {
      return [sel, ...list];
    }
    return list;
  }, [proveedorNombresSortedForm, proveedorNombreMapForm, editProveedorFilter, formData.proveedor]);

  const stockProveedorNombreMap = useMemo(() => {
    const m = buildProveedorNombrePorLinea(proveedoresLista);
    const pe = stockAdjustment.proveedorEntrada.trim();
    if (pe) {
      const n = normalizeProveedorNombreGuardado(pe);
      if (n && !m.has(n)) m.set(n, { codigo: '', nombre: n });
    }
    return m;
  }, [proveedoresLista, stockAdjustment.proveedorEntrada]);

  const stockProveedorNombresSorted = useMemo(
    () => [...stockProveedorNombreMap.keys()].sort((a, b) => a.localeCompare(b, 'es')),
    [stockProveedorNombreMap]
  );

  const stockProveedorOptionsForSelect = useMemo(() => {
    const q = stockProveedorFilter.trim().toLowerCase();
    let list = stockProveedorNombresSorted;
    if (q.length > 0) {
      list = stockProveedorNombresSorted.filter((nombre) => {
        const row = stockProveedorNombreMap.get(nombre);
        const cod = (row?.codigo ?? '').toLowerCase();
        return nombre.toLowerCase().includes(q) || cod.includes(q);
      });
    }
    const sel = stockAdjustment.proveedorEntrada.trim()
      ? normalizeProveedorNombreGuardado(stockAdjustment.proveedorEntrada)
      : '';
    if (sel && !list.includes(sel)) {
      return [sel, ...list];
    }
    return list;
  }, [stockProveedorNombresSorted, stockProveedorNombreMap, stockProveedorFilter, stockAdjustment.proveedorEntrada]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDebouncedInventorySearch('');
      return;
    }
    const t = window.setTimeout(() => setDebouncedInventorySearch(searchQuery), 120);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
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
        existencia: false,
        existenciaMinima: false,
      });
      setAddTemplateSearch('');
      setAddTemplateComboOpen(false);
      setAddTemplateLlegadaOpen(false);
      setAddTemplateLlegadaProduct(null);
      setAddTemplateLlegadaQtyStr('');
      setAddProveedorFilter('');
      setAddPrecioIvaMode('sin');
    }
  }, [showAddDialog]);

  useEffect(() => {
    if (showEditDialog) {
      setEditProveedorFilter('');
      setStockProveedorFilter('');
    }
  }, [showEditDialog]);

  useEffect(() => {
    if (showEditDialog) {
      setEditNumFocus({ existenciaMinima: false });
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
    const proveedorParaSiguiente = normalizeProveedorNombreGuardado(formData.proveedor);
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
        proveedor: proveedorParaSiguiente,
        activo: true,
        unidadMedida: normalizeClaveUnidadSat(formData.unidadMedida),
        claveProdServ: cps,
        preciosPorListaCliente: preciosPorListaCliente ?? {},
        ubicacionFisica: (formData.ubicacionFisica ?? '').trim(),
      } as any);
      addSessionLinesRef.current = [
        ...addSessionLinesRef.current,
        { nombre, sku: skuFinal, subtotalSinIva: compraSubSinIva },
      ];
      if (andAnother) {
        setAddProveedorSelectKey((k) => k + 1);
        setAddFormTemplateId('__none__');
        setAddTemplateSearch('');
        setAddTemplateComboOpen(false);
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
          proveedor: proveedorParaSiguiente,
          unidadMedida: 'H87',
          claveProdServ: DEFAULT_CLAVE_PROD_SERV,
          ubicacionFisica: '',
        });
        setPreciosListaStr(emptyPreciosListaStr());
        setListasPrecioMainDraft({});
        setAddNumFocus({
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
        addToast({ type: 'success', message: 'Producto agregado exitosamente'});
      }
    } catch (error: any) {
      addToast({ type: 'error', message: error.message});
    }
  };

  const handleEditProduct = async () => {
    if (!selectedProduct) return;

    const listaMerged = mergeListasPrecioDraftIntoStorage(
      preciosListaStr,
      listasPrecioMainDraft,
      editListaStorageIncluyeIva,
      editPreciosListaIvaMode === 'con',
      formData.impuesto
    );
    const preciosPorListaCliente = parsePreciosListaForm(listaMerged);

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
        proveedor: normalizeProveedorNombreGuardado(formData.proveedor),
        unidadMedida: normalizeClaveUnidadSat(formData.unidadMedida),
        claveProdServ: cpsEdit,
        preciosPorListaCliente: preciosPorListaCliente ?? {},
        ubicacionFisica: (formData.ubicacionFisica ?? '').trim(),
      });
      setShowEditDialog(false);
      setSelectedProduct(null);
      setListasPrecioMainDraft({});
      addToast({ type: 'success', message: 'Producto actualizado exitosamente'});
    } catch (error: any) {
      addToast({ type: 'error', message: error.message});
    }
  };

  const handleDeleteProduct = (product: Product) => {
    requestManagerAuth(() => setDeleteProductTarget(product));
  };

  const confirmDeleteProduct = async () => {
    if (!deleteProductTarget) return;
    setDeletingProduct(true);
    try {
      await removeProduct(deleteProductTarget.id);
      addToast({ type: 'success', message: 'Producto eliminado exitosamente'});
      setDeleteProductTarget(null);
    } catch (error: any) {
      addToast({ type: 'error', message: error.message});
    } finally {
      setDeletingProduct(false);
    }
  };

  const handleStockAdjustment = async () => {
    if (!selectedProduct) return;
    const motivoMovTrim = (stockAdjustment.motivo ?? '').trim();
    const motivoMov = motivoMovTrim ? upperTxt(motivoMovTrim) : '';

    try {
      const provNombre = stockAdjustment.proveedorEntrada.trim()
        ? normalizeProveedorNombreGuardado(stockAdjustment.proveedorEntrada)
        : '';
      const entradaMeta =
        stockAdjustment.tipo === 'entrada'
          ? {
              proveedor: provNombre || undefined,
              proveedorCodigo: provNombre
                ? lookupProveedorCodigo(provNombre, proveedoresLista)
                : undefined,
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
        user?.id ?? 'system',
        entradaMeta
      );
      setStockAdjustment({
        tipo: 'entrada',
        cantidad: 0,
        motivo: '',
        proveedorEntrada: normalizeProveedorNombreGuardado(formData.proveedor),
        precioCompraUnit: formData.precioCompra > 0 ? formData.precioCompra : 0,
      });
      setStockQtyFocus(false);
      addToast({ type: 'success', message: 'Stock ajustado exitosamente'});
    } catch (error: any) {
      addToast({ type: 'error', message: error.message});
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
      addToast({ type: 'success', message: 'Historial de movimientos vaciado.'});
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
    (product: Product, opts?: { existencia?: number }) => {
      const p = productById.get(product.id) ?? product;
      const existencia =
        opts?.existencia !== undefined ? opts.existencia : p.existencia;
      setFormData({
        sku: p.sku,
        codigoBarras: p.codigoBarras || '',
        nombre: p.nombre,
        descripcion: p.descripcion || '',
        precioVenta: p.precioVenta,
        precioCompra: p.precioCompra || 0,
        impuesto: p.impuesto,
        existencia,
        existenciaMinima: p.existenciaMinima,
        categoria: p.categoria || '',
        proveedor: normalizeProveedorNombreGuardado(p.proveedor || ''),
        unidadMedida: normalizeClaveUnidadSat(p.unidadMedida),
        claveProdServ: resolveClaveProdServ(p.claveProdServ),
        ubicacionFisica:
          (p.ubicacionFisica ?? '').trim() || getUbicacionesProducto(p.sku, p.codigoBarras)[0] || '',
      });
      const pl = emptyPreciosListaStr();
      for (const id of priceListCatalog.ids) {
        const v = p.preciosPorListaCliente?.[id];
        pl[id] = v != null && Number.isFinite(v) ? String(v) : '';
      }
      setPreciosListaStr(pl);
      setListasPrecioMainDraft({});
    },
    [productById, priceListCatalog.ids]
  );

  const confirmAddTemplateLlegada = useCallback(() => {
    const p = addTemplateLlegadaProduct;
    if (!p) return;
    const meta = satUnidadLlegadaLabels(p.unidadMedida ?? 'H87');
    const llegada = parseCantidadLlegadaSat(addTemplateLlegadaQtyStr, meta.permitirDecimal);
    const base = Number(p.existencia) || 0;
    const u = normalizeClaveUnidadSat(p.unidadMedida);
    const sum = base + llegada;
    const existenciaFinal =
      u === 'MTR' || u === 'CMT'
        ? Math.round(sum * 1000) / 1000
        : Math.max(0, Math.round(sum));
    applyProductTemplateToAddForm(p, { existencia: existenciaFinal });
    setAddFormTemplateId(p.id);
    setAddTemplateLlegadaOpen(false);
    setAddTemplateLlegadaProduct(null);
    setAddTemplateLlegadaQtyStr('');
    requestAnimationFrame(() => addCodigoBarrasRef.current?.focus());
  }, [addTemplateLlegadaProduct, addTemplateLlegadaQtyStr, applyProductTemplateToAddForm]);

  const addTemplateLlegadaMeta = useMemo(() => {
    if (!addTemplateLlegadaProduct) return null;
    return satUnidadLlegadaLabels(addTemplateLlegadaProduct.unidadMedida ?? 'H87');
  }, [addTemplateLlegadaProduct]);

  const openEditDialogUnlocked = (product: Product) => {
    setSelectedProduct(product);
    setUbicacionReplaceConfirm(null);
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
      proveedor: normalizeProveedorNombreGuardado(product.proveedor || ''),
      unidadMedida: normalizeClaveUnidadSat(product.unidadMedida),
      claveProdServ: resolveClaveProdServ(product.claveProdServ),
      ubicacionFisica:
        (product.ubicacionFisica ?? '').trim() ||
        getUbicacionesProducto(product.sku, product.codigoBarras)[0] ||
        '',
    });
    const pl = emptyPreciosListaStr();
    for (const id of priceListCatalog.ids) {
      const v = product.preciosPorListaCliente?.[id];
      pl[id] = v != null && Number.isFinite(v) ? String(v) : '';
    }
    setPreciosListaStr(pl);
    setListasPrecioMainDraft({});
    setStockAdjustment({
      tipo: 'entrada',
      cantidad: 0,
      motivo: '',
      proveedorEntrada: normalizeProveedorNombreGuardado(product.proveedor || ''),
      precioCompraUnit: product.precioCompra && product.precioCompra > 0 ? product.precioCompra : 0,
    });
    setStockQtyFocus(false);
    setEditPreciosSectionOpen(false);
    setEditDialogView('edit');
    setProductHistorialMovs([]);
    setEditPrecioIvaMode('sin');
    setEditPreciosListaIvaMode('sin');
    setShowEditDialog(true);
  };

  const openEditDialog = (product: Product) => {
    requestManagerAuth(() => openEditDialogUnlocked(product));
  };

  /** Abrir edición desde Misiones de inventario (`navigate` con `state.editProductId`). */
  useEffect(() => {
    const st = location.state as { editProductId?: string } | null;
    const id = st?.editProductId?.trim();
    if (!id) {
      consumedEditFromMissions.current = null;
      return;
    }
    if (loading) return;
    if (consumedEditFromMissions.current === id) return;
    const p = products.find((x) => x.id === id);
    navigate('.', { replace: true, state: {} });
    if (!p) {
      addToast({ type: 'warning', message: 'El producto no está en el catálogo de esta sucursal.' });
      consumedEditFromMissions.current = id;
      return;
    }
    consumedEditFromMissions.current = id;
    openEditDialog(p);
    // openEditDialog es estable en intención; dependencias explícitas evitarían bucles con setState interno.
  }, [location.state, products, loading, navigate, addToast]);

  const openPreciosDialog = useCallback(
    (product: Product) => {
      requestManagerAuth(() => {
        const p = productById.get(product.id) ?? product;
        const pl = emptyPreciosListaStr();
        for (const id of priceListCatalog.ids) {
          const v = p.preciosPorListaCliente?.[id];
          pl[id] = v != null && Number.isFinite(v) ? String(v) : '';
        }
        setListasPrecioDialogDraft({});
        setPreciosDialogListaStr(pl);
        setPreciosDialogProduct(p);
        setPreciosDialogListaIvaMode('sin');
        setPreciosDialogOpen(true);
      });
    },
    [productById, priceListCatalog.ids, requestManagerAuth]
  );

  const handleSavePreciosDialog = async () => {
    const p = preciosDialogProduct;
    if (!p) return;
    const fresh = productById.get(p.id) ?? p;
    const listaMerged = mergeListasPrecioDraftIntoStorage(
      preciosDialogListaStr,
      listasPrecioDialogDraft,
      preciosDialogListaStorageIncluyeIva,
      preciosDialogListaIvaMode === 'con',
      p.impuesto ?? 16
    );
    const preciosPorListaCliente = parsePreciosListaForm(listaMerged);
    setPreciosDialogSaving(true);
    try {
      await editProduct(fresh.id, {
        preciosPorListaCliente: preciosPorListaCliente ?? {},
      });
      addToast({ type: 'success', message: 'Precios por lista actualizados'});
      setPreciosDialogOpen(false);
      setPreciosDialogProduct(null);
      setListasPrecioDialogDraft({});
    } catch (err: unknown) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudieron guardar los precios',
      });
    } finally {
      setPreciosDialogSaving(false);
    }
  };

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
        const entradas = rows.filter(isMovimientoLlegadaMercancia);
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

  useEffect(() => {
    if (!showEditDialog || editDialogView !== 'historial' || !selectedProduct) {
      if (editDialogView !== 'historial') {
        setProductHistorialMovs([]);
        setProductHistorialLoading(false);
      }
      return;
    }
    const pid = selectedProduct.id;
    let cancelled = false;
    setProductHistorialLoading(true);
    setProductHistorialMovs([]);
    void getInventoryMovementsByProductId(pid, { sucursalId: effectiveSucursalId, limit: 500 })
      .then((rows: InventoryMovement[]) => {
        if (!cancelled) setProductHistorialMovs(rows);
      })
      .catch(() => {
        if (!cancelled) setProductHistorialMovs([]);
      })
      .finally(() => {
        if (!cancelled) setProductHistorialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showEditDialog, editDialogView, selectedProduct?.id, effectiveSucursalId]);

  const valorInventarioTotal = useMemo(
    () =>
      products.reduce((sum, p) => {
        if (productEsServicio(p)) return sum;
        return sum + getProductPrecioPublicoRegular(p) * p.existencia;
      }, 0),
    [products]
  );

  const totalUnidadesStock = useMemo(
    () =>
      products.reduce((sum, p) => {
        if (productEsServicio(p)) return sum;
        return sum + p.existencia;
      }, 0),
    [products]
  );
  /** Suma cruda puede tener decimales (p. ej. productos MTR/CMT por metro); en la tarjeta se muestra entero. */
  const totalUnidadesStockDisplay = Math.round(totalUnidadesStock);
  const isInventoryLoadingUi = loading || inventoryBootstrapping;

  useEffect(() => {
    if (productsError) {
      setInventoryBootstrapping(false);
      return;
    }
    if (products.length > 0) {
      setInventoryBootstrapping(false);
      return;
    }
    if (loading) return;
    const t = window.setTimeout(() => {
      setInventoryBootstrapping(false);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [loading, products.length, productsError]);

  const stockBajoCount = useMemo(
    () => products.filter(isStockBajo).length,
    [products]
  );

  const skuCount = useMemo(
    () => products.filter((p) => String(p.sku ?? '').trim().length > 0).length,
    [products]
  );

  const productSearchIndex = useMemo(() => buildProductSearchIndex(products), [products]);

  const pool = useMemo(() => {
    return debouncedInventorySearch.trim()
      ? searchProductIndex(productSearchIndex, debouncedInventorySearch)
      : products;
  }, [products, productSearchIndex, debouncedInventorySearch]);

  const handleInventorySortClick = useCallback((key: InventorySortKey) => {
    setInventorySort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }, []);

  const displayProducts = useMemo(() => {
    let list = [...pool];
    if (inventoryMode === 'stock') {
      list = list.filter(isStockBajo);
    }
    list.sort((a, b) => compareInventoryProducts(a, b, inventorySort.key, inventorySort.dir));
    return list;
  }, [pool, inventoryMode, inventorySort]);

  useEffect(() => {
    setInventoryListPage(1);
  }, [debouncedInventorySearch, inventoryMode, inventorySort.key, inventorySort.dir, pool.length]);

  const inventoryTotalPages = Math.max(1, Math.ceil(displayProducts.length / INVENTORY_PAGE_SIZE));

  useEffect(() => {
    setInventoryListPage((p) => Math.min(Math.max(1, p), inventoryTotalPages));
  }, [inventoryTotalPages]);

  const visibleInventoryProducts = useMemo(() => {
    const start = (inventoryListPage - 1) * INVENTORY_PAGE_SIZE;
    return displayProducts.slice(start, start + INVENTORY_PAGE_SIZE);
  }, [displayProducts, inventoryListPage]);

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
      const saveSku = async () => {
        try {
          await editProduct(product.id, { sku: raw });
          addToast({ type: 'success', message: 'SKU actualizado'});
        } catch (e: unknown) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'No se pudo guardar el SKU',
          });
          setSkuDrafts((prev) => ({ ...prev, [product.id]: product.sku }));
        }
      };
      requestManagerAuth(
        () => {
          void saveSku();
        },
        () => setSkuDrafts((prev) => ({ ...prev, [product.id]: product.sku }))
      );
    },
    [skuDrafts, editProduct, addToast, requestManagerAuth]
  );

  const modeHint: Record<InventoryMode, string> = {
    productos: '',
    stock: 'Stock en cero, por debajo del mínimo, o por debajo del 15% del mínimo configurado.',
    valor:
      'La tarjeta muestra la suma del precio Lista Regular (1 u. por artículo) y, debajo, el valor en existencias (precio × stock). La lista se ordena por precio (mayor primero).',
    codigos: 'Nombre y SKU. Edita el SKU y guarda al salir del campo.',
  };

  const resetForm = () => {
    setAddProveedorSelectKey(0);
    setAddFormTemplateId('__none__');
    setAddTemplateSearch('');
    setAddTemplateComboOpen(false);
    setAddTemplateLlegadaOpen(false);
    setAddTemplateLlegadaProduct(null);
    setAddTemplateLlegadaQtyStr('');
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
      claveProdServ: DEFAULT_CLAVE_PROD_SERV,
      ubicacionFisica: '',
    });
    setPreciosListaStr(emptyPreciosListaStr());
    setListasPrecioMainDraft({});
  };

  const handleDescargarInventario = useCallback(() => {
    if (exportingInventario) return;
    setExportingInventario(true);
    try {
      downloadInventarioCompleto({
        products,
        sucursalNombre: effectiveSucursalId ? nombreSucursal(effectiveSucursalId) : undefined,
      });
      addToast({
        type: 'success',
        message: 'Archivo CSV descargado. Ábralo en Excel o LibreOffice; desde ahí puede imprimir o guardar como Excel.',
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo generar el archivo.',
      });
    } finally {
      setExportingInventario(false);
    }
  }, [
    exportingInventario,
    products,
    effectiveSucursalId,
    nombreSucursal,
    addToast,
  ]);

  const handleDescargarStockBajo = useCallback(() => {
    if (exportingInventario) return;
    const items = products.filter(isStockBajo);
    if (items.length === 0) {
      addToast({ type: 'info', message: 'No hay artículos con stock bajo para exportar.' });
      return;
    }
    setExportingInventario(true);
    try {
      downloadInventarioStockBajo({
        products,
        sucursalNombre: effectiveSucursalId ? nombreSucursal(effectiveSucursalId) : undefined,
      });
      addToast({
        type: 'success',
        message: `Archivo CSV descargado (${items.length} artículos). Ábralo en Excel o guárdelo como .xlsx.`,
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo generar el archivo.',
      });
    } finally {
      setExportingInventario(false);
    }
  }, [
    exportingInventario,
    products,
    effectiveSucursalId,
    nombreSucursal,
    addToast,
  ]);

  const handleTicketStockBajo = useCallback(() => {
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
  }, [products, effectiveSucursalId, addToast]);

  const openNuevoProductoDialog = () => {
    requestManagerAuth(() => {
      resetForm();
      addSessionLinesRef.current = [];
      setShowAddDialog(true);
    });
  };

  const openNuevoRef = useRef(openNuevoProductoDialog);
  openNuevoRef.current = openNuevoProductoDialog;

  useEffect(() => {
    setInventarioHeaderBridge({
      onHistorial: () => setMovementsHistoryOpen(true),
      onTicketStockBajo: handleTicketStockBajo,
      onDescargar: () => void handleDescargarInventario(),
      onNuevo: () => openNuevoRef.current(),
      descargarDisabled: loading || exportingInventario,
      exportingInventario,
    });
    return () => clearInventarioHeaderBridge();
  }, [loading, exportingInventario, handleTicketStockBajo, handleDescargarInventario]);

  return (
    <>
    <PageShell
      title="Inventario"
      subtitle="Productos y stock"
      className="min-w-0 max-w-none"
      actionsClassName="sm:justify-end"
      actions={
        <div
          className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-2.5 py-1.5 dark:border-slate-800/50 dark:bg-slate-900/50 sm:gap-3 sm:px-3 sm:py-2"
          title={
            totalUnidadesStock % 1 === 0
              ? 'Suma de existencias de todos los productos físicos (excluye servicios).'
              : 'Suma de existencias (físicos, sin servicios). Puede incluir decimales por artículos vendidos por metro o centímetro (MTR/CMT); el número mostrado está redondeado al entero más cercano.'
          }
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 sm:h-9 sm:w-9">
            <Layers className="h-4 w-4 text-brand sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0 text-right">
            <p className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-lg">
              {isInventoryLoadingUi ? (
                <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand align-middle sm:h-6 sm:w-6" />
              ) : (
                new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(
                  totalUnidadesStockDisplay
                )
              )}
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Unidades en stock</p>
          </div>
        </div>
      }
    >
      <div className="grid w-full min-w-0 shrink-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4 lg:gap-3">
        <button
          type="button"
          onClick={() => setInventoryModeWithDefaultSort('productos')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'productos'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/20 sm:h-10 sm:w-10">
              <Package className="h-4 w-4 text-brand sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
                {isInventoryLoadingUi ? (
                  <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand align-middle sm:h-6 sm:w-6" />
                ) : (
                  products.length
                )}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Productos</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryModeWithDefaultSort('stock')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'stock'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 sm:h-10 sm:w-10">
              <AlertTriangle className="h-4 w-4 text-amber-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
                {isInventoryLoadingUi ? (
                  <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500 align-middle sm:h-6 sm:w-6" />
                ) : (
                  stockBajoCount
                )}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Stock bajo</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryModeWithDefaultSort('valor')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'valor'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 sm:h-10 sm:w-10">
              <TrendingUp className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p
                className="truncate text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-xl"
                title="Suma de (precio Regular con IVA × existencia) por artículo físico."
              >
                {isInventoryLoadingUi ? (
                  <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500 align-middle sm:h-6 sm:w-6" />
                ) : (
                  formatMoney(valorInventarioTotal)
                )}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">Valor</p>
            </div>
          </CardContent>
        </button>
        <button
          type="button"
          onClick={() => setInventoryModeWithDefaultSort('codigos')}
          className={cn(
            'rounded-xl border text-left transition-all',
            inventoryMode === 'codigos'
              ? 'border-brand/50 bg-slate-100/90 dark:bg-slate-900/80 ring-2 ring-brand/25'
              : 'border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 hover:border-slate-300 dark:border-slate-700/60'
          )}
        >
          <CardContent className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 sm:h-10 sm:w-10">
              <Barcode className="h-4 w-4 text-violet-400 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
                {isInventoryLoadingUi ? (
                  <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500 align-middle sm:h-6 sm:w-6" />
                ) : (
                  skuCount
                )}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">SKU</p>
            </div>
          </CardContent>
        </button>
      </div>

      {effectiveSucursalId && pendingIncoming.length > 0 ? (
        <div className="mt-3 shrink-0 rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 sm:mt-4 sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-black dark:text-amber-50">
            <Truck className="h-4 w-4 shrink-0 text-amber-800 dark:text-amber-400" />
            Traspasos pendientes de recibir
            <Badge variant="secondary" className="border-amber-500/40 bg-amber-500/15 text-black dark:text-amber-100">
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
                          <span className="font-mono text-brand/90">{t.origenFolio}</span>
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

      <div className="mt-3 shrink-0 rounded-xl border border-brand/30 bg-brand/5 p-3 sm:mt-4 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recepción de pedidos (factura antes que la mercancía)
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
              Registre la factura del proveedor sin mover stock. Al llegar el pedido (completo o en partes), confirme la
              recepción para sumar inventario y actualizar el precio de compra si aplica.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" asChild>
            <Link to="/inventario/recepcion-pedidos">Abrir recepción de pedidos</Link>
          </Button>
        </div>
      </div>

      <div className="mt-3 shrink-0 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 sm:mt-4 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Salidas de mercancía (sin venta)
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
              Registre merma, consumo interno, devolución a proveedor u otras bajas de inventario con folio y detalle por
              producto.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" asChild>
            <Link to="/inventario/salidas-mercancia">Abrir salidas de mercancía</Link>
          </Button>
        </div>
      </div>

      {productsError ? (
        <div
          role="alert"
          className="mt-3 shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-900 dark:text-red-100"
        >
          <p className="font-medium">No se pudo cargar el inventario</p>
          <p className="mt-1 text-xs leading-snug opacity-95">{productsError}</p>
        </div>
      ) : null}

      <div className="relative mt-3 mb-3 w-full min-w-0 shrink-0 sm:mt-4 sm:mb-4">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar nombre, SKU, código..."
          className="h-9 w-full border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 pl-9 text-sm text-slate-900 dark:text-slate-100 sm:h-10 sm:pl-10"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:overflow-visible">
        <div className="shrink-0 pb-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">
                Lista de productos
              </CardTitle>
              {modeHint[inventoryMode] ? (
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">
                  {modeHint[inventoryMode]}
                </p>
              ) : null}
            </div>
            {inventoryMode === 'stock' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-950 hover:bg-amber-500/20 dark:text-amber-100"
                disabled={loading || exportingInventario || stockBajoCount === 0}
                onClick={() => void handleDescargarStockBajo()}
              >
                <Download className="mr-2 h-4 w-4" />
                {exportingInventario ? 'Generando…' : 'Descargar Excel'}
              </Button>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-2 md:hidden">
            <Select
              value={inventorySort.key}
              onValueChange={(v) => setInventorySort({ key: v as InventorySortKey, dir: 'asc' })}
            >
              <SelectTrigger className="h-10 min-w-0 flex-1 border-slate-300 dark:border-slate-700 bg-slate-200/80 text-sm dark:bg-slate-800/80">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nombre">Nombre</SelectItem>
                <SelectItem value="sku">SKU</SelectItem>
                <SelectItem value="precio">Precio (con IVA)</SelectItem>
                <SelectItem value="existencia">Stock</SelectItem>
                <SelectItem value="categoria">Categoría</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/80"
              onClick={() =>
                setInventorySort((prev) => ({
                  ...prev,
                  dir: prev.dir === 'asc' ? 'desc' : 'asc',
                }))
              }
              aria-label={inventorySort.dir === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
            >
              {inventorySort.dir === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/40 shadow-inner max-md:min-h-[55dvh]">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <div className="space-y-3 p-3 md:hidden">
              {isInventoryLoadingUi ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                  <p className="text-xs text-slate-600 dark:text-slate-500">Cargando tu inventario…</p>
                </div>
              ) : displayProducts.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-600 dark:text-slate-500">
                  {productsError
                    ? 'Revise el mensaje de error arriba.'
                    : searchQuery.trim()
                      ? 'No hay coincidencias con la búsqueda'
                      : 'No se encontraron productos'}
                </p>
              ) : inventoryMode === 'codigos' ? (
                visibleInventoryProducts.map((product) => (
                  <article
                    key={product.id}
                    className="rounded-xl border border-slate-200/90 bg-slate-50/95 p-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60"
                  >
                    <div className="flex gap-2">
                      <UbicacionFisicaNombre
                        product={product}
                        variant="dialog"
                        onOpenDialog={setUbicacionDialogProduct}
                        className="min-w-0 flex-1 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-800/60"
                        nameClassName="text-sm font-semibold leading-snug text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
                        pinClassName="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand dark:text-brand"
                      />
                      <InventoryProductActions
                        editLabel="Editar producto"
                        onEdit={() => openEditDialog(product)}
                        onPrecios={() => openPreciosDialog(product)}
                        onDelete={() => handleDeleteProduct(product)}
                      />
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <InventorySortLabelButton
                        sortKey="sku"
                        label="SKU"
                        inventorySort={inventorySort}
                        onSort={handleInventorySortClick}
                      />
                      <Input
                        value={skuDrafts[product.id] ?? product.sku}
                        onChange={(e) => handleSkuDraftChange(product.id, e.target.value)}
                        onBlur={() => void commitSkuIfChanged(product)}
                        className="h-10 w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800/80 font-mono text-sm text-slate-900 dark:text-slate-100"
                        aria-label={`SKU de ${product.nombre}`}
                      />
                    </div>
                    <div className="mt-2 space-y-1">
                      <InventorySortLabelButton
                        sortKey="categoria"
                        label="Categoría"
                        inventorySort={inventorySort}
                        onSort={handleInventorySortClick}
                      />
                      <Badge
                        variant="secondary"
                        className="max-w-full whitespace-normal break-words bg-slate-200 dark:bg-slate-800 text-left text-xs text-slate-700 dark:text-slate-300"
                      >
                        {product.categoria || 'Sin categoría'}
                      </Badge>
                    </div>
                  </article>
                ))
              ) : (
                visibleInventoryProducts.map((product) => (
                  <article
                    key={product.id}
                    className="rounded-xl border border-slate-200/90 bg-slate-50/95 p-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60"
                  >
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <UbicacionFisicaNombre
                          product={product}
                          variant="dialog"
                          onOpenDialog={setUbicacionDialogProduct}
                          className="w-full -mx-0.5 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-800/60"
                          nameClassName="text-sm font-semibold leading-snug text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
                          pinClassName="h-3.5 w-3.5 shrink-0 text-brand dark:text-brand"
                          layout="center"
                        />
                        {hasInventoryDescripcionVisible(product.descripcion) ? (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-500">
                            {product.descripcion}
                          </p>
                        ) : null}
                      </div>
                      <InventoryProductActions
                        onEdit={() => openEditDialog(product)}
                        onPrecios={() => openPreciosDialog(product)}
                        onDelete={() => handleDeleteProduct(product)}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/60 sm:grid-cols-4">
                      <div>
                        <InventorySortLabelButton
                          sortKey="sku"
                          label="SKU"
                          inventorySort={inventorySort}
                          onSort={handleInventorySortClick}
                        />
                        <p className="font-mono text-xs text-slate-800 dark:text-slate-200">{product.sku}</p>
                      </div>
                      <div>
                        <InventorySortLabelButton
                          sortKey="precio"
                          label="Precio"
                          inventorySort={inventorySort}
                          onSort={handleInventorySortClick}
                        />
                        <p className="text-sm font-medium tabular-nums text-brand">
                          {formatMoney(getProductPrecioPublicoRegular(product))}
                        </p>
                      </div>
                      <div>
                        <InventorySortLabelButton
                          sortKey="existencia"
                          label="Stock"
                          inventorySort={inventorySort}
                          onSort={handleInventorySortClick}
                        />
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              'text-sm font-semibold',
                              product.existencia <= product.existenciaMinima
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            )}
                          >
                            {product.existencia}
                          </span>
                          {product.existencia <= product.existenciaMinima ? (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          ) : null}
                        </div>
                      </div>
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <InventorySortLabelButton
                          sortKey="categoria"
                          label="Categoría"
                          inventorySort={inventorySort}
                          onSort={handleInventorySortClick}
                        />
                        <Badge
                          variant="secondary"
                          className="mt-0.5 max-w-full whitespace-normal break-words bg-slate-200 dark:bg-slate-800 text-left text-xs text-slate-700 dark:text-slate-300"
                        >
                          {product.categoria || 'Sin categoría'}
                        </Badge>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="hidden min-w-0 md:block">
              <Table
                containerClassName="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] touch-pan-x pb-1"
                className="table-fixed w-full min-w-[660px]"
              >
                {inventoryMode === 'codigos' ? (
                  <colgroup>
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '32%' }} />
                    <col style={{ width: '8%' }} />
                  </colgroup>
                )}
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                    {inventoryMode === 'codigos' ? (
                      <>
                        <TableHead className="sticky top-0 z-10 min-w-0 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm whitespace-normal">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('nombre')}
                            className="inline-flex max-w-full items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'nombre' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Producto
                            {inventorySort.key === 'nombre' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('sku')}
                            className="inline-flex items-center gap-1 rounded px-0.5 font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'sku' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            SKU
                            {inventorySort.key === 'sku' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 min-w-0 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm whitespace-normal">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('categoria')}
                            className="inline-flex max-w-full items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'categoria' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Categoría
                            {inventorySort.key === 'categoria' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky right-0 top-0 z-20 w-24 bg-white/95 dark:bg-slate-950/95 text-right text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Acciones
                        </TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="sticky top-0 z-10 min-w-0 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm whitespace-normal">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('nombre')}
                            className="inline-flex max-w-full items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'nombre' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Producto
                            {inventorySort.key === 'nombre' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('sku')}
                            className="inline-flex items-center gap-1 rounded px-0.5 font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'sku' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            SKU
                            {inventorySort.key === 'sku' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('precio')}
                            className="inline-flex w-full min-w-0 items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'precio' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Precio (con IVA)
                            {inventorySort.key === 'precio' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('existencia')}
                            className="inline-flex w-full min-w-0 items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'existencia' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Stock
                            {inventorySort.key === 'existencia' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 min-w-0 bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 backdrop-blur-sm whitespace-normal">
                          <button
                            type="button"
                            onClick={() => handleInventorySortClick('categoria')}
                            className="inline-flex max-w-full items-center gap-1 rounded px-0.5 text-left font-medium hover:text-slate-900 dark:hover:text-slate-100"
                            aria-sort={
                              inventorySort.key === 'categoria' ?
                                inventorySort.dir === 'asc' ?
                                  'ascending'
                                : 'descending'
                              : 'none'
                            }
                          >
                            Categoría
                            {inventorySort.key === 'categoria' ?
                              inventorySort.dir === 'asc' ?
                                <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              : <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                            : null}
                          </button>
                        </TableHead>
                        <TableHead className="sticky right-0 top-0 z-20 w-14 min-w-[3.5rem] bg-white/95 dark:bg-slate-950/95 text-right text-slate-600 dark:text-slate-400 backdrop-blur-sm">
                          Acciones
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isInventoryLoadingUi ? (
                    <TableRow>
                      <TableCell
                        colSpan={inventoryMode === 'codigos' ? 4 : 6}
                        className="py-8 text-center"
                      >
                        <div className="mx-auto flex flex-col items-center gap-2">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                          <p className="text-xs text-slate-600 dark:text-slate-500">Cargando tu inventario…</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : displayProducts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={inventoryMode === 'codigos' ? 4 : 6}
                        className="py-8 text-center text-slate-600 dark:text-slate-500"
                      >
                        {productsError
                          ? 'Revise el mensaje de error arriba.'
                          : searchQuery.trim()
                            ? 'No hay coincidencias con la búsqueda'
                            : 'No se encontraron productos'}
                      </TableCell>
                    </TableRow>
                  ) : inventoryMode === 'codigos' ? (
                    visibleInventoryProducts.map((product) => (
                      <TableRow key={product.id} className="border-slate-200/80 dark:border-slate-800/50">
                        <TableCell className="min-w-0 font-medium whitespace-normal break-words text-slate-800 dark:text-slate-200">
                          <UbicacionFisicaNombre
                            product={product}
                            variant="popover"
                            className="inline-flex max-w-full items-start gap-1.5 text-left font-medium text-slate-800 underline-offset-2 hover:underline dark:text-slate-200"
                            nameClassName="min-w-0 break-words"
                            pinClassName="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand dark:text-brand"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={skuDrafts[product.id] ?? product.sku}
                            onChange={(e) => handleSkuDraftChange(product.id, e.target.value)}
                            onBlur={() => void commitSkuIfChanged(product)}
                            className="h-9 w-full max-w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800/80 font-mono text-sm text-slate-900 dark:text-slate-100"
                            aria-label={`SKU de ${product.nombre}`}
                          />
                        </TableCell>
                        <TableCell className="min-w-0 max-w-[10rem] align-top whitespace-normal">
                          <Badge
                            variant="secondary"
                            className="max-w-full whitespace-normal break-words bg-slate-200 dark:bg-slate-800 text-left text-xs text-slate-700 dark:text-slate-300"
                          >
                            {product.categoria || 'Sin categoría'}
                          </Badge>
                        </TableCell>
                        <TableCell className="sticky right-0 z-[1] bg-slate-50 text-right dark:bg-slate-950/95">
                          <InventoryProductActions
                            editLabel="Editar producto"
                            onEdit={() => openEditDialog(product)}
                            onPrecios={() => openPreciosDialog(product)}
                            onDelete={() => handleDeleteProduct(product)}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    visibleInventoryProducts.map((product) => (
                      <TableRow key={product.id} className="border-slate-200/80 dark:border-slate-800/50">
                        <TableCell className="min-w-0 align-top whitespace-normal">
                          <div className="min-w-0 break-words">
                            <UbicacionFisicaNombre
                              product={product}
                              variant="popover"
                              className="inline-flex max-w-full items-start gap-1.5 text-left font-medium text-slate-800 underline-offset-2 hover:underline dark:text-slate-200"
                              nameClassName="min-w-0 break-words"
                              pinClassName="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand dark:text-brand"
                            />
                            {hasInventoryDescripcionVisible(product.descripcion) ? (
                              <p className="text-xs text-slate-600 dark:text-slate-500">{product.descripcion}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-600 dark:text-slate-400">{product.sku}</TableCell>
                        <TableCell className="font-medium tabular-nums text-brand">
                          {formatMoney(getProductPrecioPublicoRegular(product))}
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
                        <TableCell className="min-w-0 max-w-[12rem] align-top whitespace-normal">
                          <Badge
                            variant="secondary"
                            className="max-w-full whitespace-normal break-words bg-slate-200 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-300"
                          >
                            {product.categoria || 'Sin categoría'}
                          </Badge>
                        </TableCell>
                        <TableCell className="sticky right-0 z-[1] w-14 min-w-[3.5rem] bg-slate-50 text-right dark:bg-slate-950/95">
                          <InventoryProductActions
                            onEdit={() => openEditDialog(product)}
                            onPrecios={() => openPreciosDialog(product)}
                            onDelete={() => handleDeleteProduct(product)}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          {displayProducts.length > INVENTORY_PAGE_SIZE ? (
            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-100/95 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/80 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-slate-600 dark:text-slate-400 sm:text-xs">
                Mostrando{' '}
                <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">
                  {(inventoryListPage - 1) * INVENTORY_PAGE_SIZE + 1}
                </span>
                –
                <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">
                  {Math.min(inventoryListPage * INVENTORY_PAGE_SIZE, displayProducts.length)}
                </span>{' '}
                de <span className="font-medium tabular-nums">{displayProducts.length}</span> · Página{' '}
                <span className="tabular-nums">
                  {inventoryListPage}/{inventoryTotalPages}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-300 text-xs dark:border-slate-600"
                  disabled={inventoryListPage <= 1}
                  onClick={() => setInventoryListPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-300 text-xs dark:border-slate-600"
                  disabled={inventoryListPage >= inventoryTotalPages}
                  onClick={() => setInventoryListPage((p) => Math.min(inventoryTotalPages, p + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
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
        <DialogContent className="flex max-h-[92dvh] flex-col overflow-y-auto border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 md:max-w-[min(92vw,64rem)] lg:max-h-none lg:max-w-[min(96vw,90rem)] lg:overflow-visible xl:max-w-[min(98vw,104rem)]">
          <DialogHeader className="shrink-0 space-y-0.5 pb-1 text-left sm:text-left">
            <DialogTitle className="text-lg lg:text-base">Nuevo Producto</DialogTitle>
            <DialogDescription className="text-left text-xs text-slate-600 dark:text-slate-400 lg:text-[11px] lg:leading-snug">
              Nombre, SKU, código y descripción se guardan en <span className="font-medium text-slate-800 dark:text-slate-200">MAYÚSCULAS</span> aunque
              escriba en minúsculas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2 sm:gap-3 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-2 lg:py-2">
            <div className="col-span-2 space-y-1.5 rounded-lg border border-brand/25 bg-brand/[0.08] p-2.5 dark:border-brand/30 dark:bg-brand-to/25 lg:col-span-2 lg:space-y-1 lg:p-2">
              <Label>Copiar desde producto existente</Label>
              {addFormTemplateId !== '__none__' ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    Plantilla: {productById.get(addFormTemplateId)?.nombre ?? addFormTemplateId}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-slate-400 text-xs dark:border-slate-600"
                    onClick={() => {
                      setAddFormTemplateId('__none__');
                      setAddTemplateSearch('');
                      setAddTemplateComboOpen(false);
                    }}
                  >
                    Quitar plantilla
                  </Button>
                </div>
              ) : (
                <Popover modal={false} open={addTemplateComboOpen} onOpenChange={setAddTemplateComboOpen}>
                  <PopoverAnchor asChild>
                    <div className="w-full">
                      <Input
                        value={addTemplateSearch}
                        onChange={(e) => {
                          setAddTemplateSearch(e.target.value);
                          setAddTemplateComboOpen(true);
                        }}
                        onFocus={() => setAddTemplateComboOpen(true)}
                        placeholder="Escriba nombre, SKU o código de barras…"
                        autoComplete="off"
                        className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </PopoverAnchor>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    className={cn(
                      'z-[300] w-[var(--radix-popover-anchor-width)] border-slate-200 bg-slate-100 p-0 shadow-lg dark:border-slate-800 dark:bg-slate-900',
                      'max-h-[min(50dvh,18rem)] overflow-hidden'
                    )}
                  >
                    {addTemplateSearch.trim().length < 1 ? (
                      <p className="px-3 py-3 text-xs leading-snug text-slate-600 dark:text-slate-400">
                        Escriba al menos un carácter para buscar en el catálogo. No se muestra la lista completa.
                      </p>
                    ) : addTemplateMatches.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                        Sin coincidencias.
                      </p>
                    ) : (
                      <ul className="max-h-[min(50dvh,18rem)] overflow-y-auto overscroll-contain py-1">
                        {addTemplateMatches.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-200/90 dark:hover:bg-slate-800/90"
                              onClick={() => {
                                setAddTemplateLlegadaProduct(p);
                                setAddTemplateLlegadaQtyStr('');
                                setAddTemplateLlegadaOpen(true);
                                setAddTemplateSearch('');
                                setAddTemplateComboOpen(false);
                              }}
                            >
                              <span className="font-medium text-slate-900 dark:text-slate-100">{p.nombre}</span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                SKU {p.sku}
                                {p.codigoBarras?.trim() ? ` · ${p.codigoBarras.trim()}` : ''}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 lg:text-[10px] lg:leading-tight">
                Escriba para buscar; al elegir un artículo se abre un paso para indicar cuánto llegó (piezas, metros,
                etc., según la unidad SAT) y se suma a la existencia copiada. Luego cambie SKU, código o stock si es
                variante o entrada nueva y guarde.
              </p>
            </div>
            <div className="col-span-2 space-y-1.5 rounded-lg border border-slate-200/80 bg-slate-200/35 p-2.5 dark:border-slate-700/60 dark:bg-slate-800/40 lg:col-span-2 lg:space-y-1 lg:p-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-1">
                  <Label>Proveedor</Label>
                  <Select
                    key={addProveedorSelectKey}
                    value={
                      formData.proveedor?.trim()
                        ? normalizeProveedorNombreGuardado(formData.proveedor) || '__none__'
                        : '__none__'
                    }
                    onValueChange={(v) =>
                      setFormData({ ...formData, proveedor: v === '__none__' ? '' : v })
                    }
                  >
                    <SelectTrigger className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9">
                      <SelectValue placeholder="Sin proveedor" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                    >
                      <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                        Sin proveedor
                      </SelectItem>
                      {proveedorOptionsForAddSelect.map((c) => (
                        <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                          {proveedorSelectItemLabel(c, proveedorNombreMapForm)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full shrink-0 space-y-1.5 sm:w-44 sm:space-y-1">
                  <Label className="text-slate-600 dark:text-slate-400">Buscar (código o nombre)</Label>
                  <Input
                    value={addProveedorFilter}
                    onChange={(e) => setAddProveedorFilter(upperTxt(e.target.value))}
                    placeholder="Ej. PRV01"
                    autoComplete="off"
                    className="h-10 border-slate-300 bg-slate-200 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
                  />
                </div>
              </div>
              <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 lg:text-[10px] lg:leading-tight">
                En Configuración puede definir líneas <span className="font-mono">CODIGO|NOMBRE</span>. Use el campo de
                búsqueda para filtrar por código o nombre. Varios artículos del mismo proveedor: elija el proveedor
                aquí una vez y use{' '}
                <span className="font-medium text-slate-700 dark:text-slate-300">Guardar y otro producto</span> para
                vaciar solo SKU, código y datos del artículo y seguir capturando.
              </p>
            </div>
            <div className="space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">SKU</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: upperTxt(e.target.value) })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Código de Barras *</Label>
              <Input
                ref={addCodigoBarrasRef}
                value={formData.codigoBarras}
                onChange={(e) => setFormData({ ...formData, codigoBarras: upperTxt(e.target.value) })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Nombre *</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: upperTxt(e.target.value) })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Descripción</Label>
              <Input
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: upperTxt(e.target.value) })}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Unidad SAT (CFDI 4.0) *</Label>
              <Select
                value={formData.unidadMedida}
                onValueChange={(v) => setFormData({ ...formData, unidadMedida: v })}
              >
                <SelectTrigger className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9">
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
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 lg:leading-tight">
                Clave de unidad del catálogo del SAT (misma que usará la factura).
              </p>
            </div>
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Clave Producto/Servicio SAT *</Label>
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
                className="h-10 border-slate-300 bg-slate-200 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 lg:leading-tight">
                8 dígitos según catálogo c_ClaveProdServ del SAT (facturación).
              </p>
            </div>
            <div className="col-span-2 flex flex-col gap-2 border-b border-slate-200/80 pb-3 dark:border-slate-700/80 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Precios de venta y compra (elija cómo capturarlos)
              </p>
              <InventarioPrecioIvaModeToggle value={addPrecioIvaMode} onChange={setAddPrecioIvaMode} />
            </div>
            <div className="space-y-1.5 lg:col-span-1 lg:space-y-1">
              <Label className="text-sm lg:text-xs">
                {addPrecioIvaMode === 'con' ? 'Precio de venta (con IVA) *' : 'Precio de venta (sin IVA) *'}
              </Label>
              <InventarioStoredMoneyInput
                min={0}
                step="any"
                storedSinIva={formData.precioVenta}
                onStoredSinIvaChange={(n) => {
                  setFormData((d) => ({ ...d, precioVenta: n }));
                  cascadeListasFromPrecioVenta(n, formData.impuesto, defaultListaPreciosIncluyenIva());
                }}
                ivaMode={addPrecioIvaMode}
                impuestoPct={formData.impuesto}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 lg:line-clamp-2">
                {formData.precioVenta > 0 ? (
                  addPrecioIvaMode === 'sin' ? (
                    <>
                      Con IVA ({formData.impuesto}%):{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatMoney(precioVentaSinIvaToConIva(formData.precioVenta, formData.impuesto))}
                      </span>
                      . Se guarda en catálogo el precio sin IVA.
                    </>
                  ) : (
                    <>
                      Sin IVA:{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatMoney(formData.precioVenta)}
                      </span>
                      . El catálogo guarda siempre la base sin impuesto.
                    </>
                  )
                ) : addPrecioIvaMode === 'sin' ? (
                  <>
                    Ingrese el precio base sin impuesto; el sistema calcula el precio con IVA (tasa{' '}
                    {formData.impuesto}%).
                  </>
                ) : (
                  <>
                    Ingrese el precio al público con IVA; el sistema guarda la base sin impuesto (tasa{' '}
                    {formData.impuesto}%).
                  </>
                )}
              </p>
            </div>
            <div className="space-y-1.5 lg:col-span-1 lg:space-y-1">
              <Label className="text-sm lg:text-xs">
                {addPrecioIvaMode === 'con' ? 'Precio de compra (con IVA)' : 'Precio de compra (sin IVA)'}
              </Label>
              <InventarioStoredMoneyInput
                min={0}
                step="any"
                storedSinIva={formData.precioCompra}
                onStoredSinIvaChange={(n) => setFormData((d) => ({ ...d, precioCompra: n }))}
                ivaMode={addPrecioIvaMode}
                impuestoPct={formData.impuesto}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 lg:leading-tight">
                {addPrecioIvaMode === 'sin' ? (
                  'Mismo criterio que en la factura de compra (base sin impuesto).'
                ) : formData.precioCompra > 0 ? (
                  <>
                    Equiv. sin IVA:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatMoney(formData.precioCompra)}
                    </span>
                    . Se guarda en catálogo sin impuesto.
                  </>
                ) : (
                  'Ingrese el costo unitario con IVA incluido; se guarda la base sin impuesto.'
                )}
              </p>
            </div>
            <div className="space-y-1.5 lg:col-span-1 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Stock Inicial</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={
                  normalizeClaveUnidadSat(formData.unidadMedida) === 'MTR' ||
                  normalizeClaveUnidadSat(formData.unidadMedida) === 'CMT'
                    ? 'any'
                    : 1
                }
                value={addNumFocus.existencia && formData.existencia === 0 ? '' : formData.existencia}
                onFocus={() => setAddNumFocus((f) => ({ ...f, existencia: true }))}
                onBlur={() => setAddNumFocus((f) => ({ ...f, existencia: false }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFormData((d) => ({ ...d, existencia: 0 }));
                  else
                    setFormData((d) => ({
                      ...d,
                      existencia: parseExistenciaInventarioForm(v, d.unidadMedida),
                    }));
                }}
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="space-y-1.5 lg:col-span-1 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Stock Mínimo</Label>
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
                className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9"
              />
            </div>
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Categoría</Label>
              <Select
                value={formData.categoria || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, categoria: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9">
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
            <div className="col-span-2 space-y-1.5 lg:col-span-2 lg:space-y-1">
              <Label className="text-sm lg:text-xs">Ubicación física (mueble)</Label>
              <Select
                value={formData.ubicacionFisica || '__none__'}
                onValueChange={(v) =>
                  setFormData({ ...formData, ubicacionFisica: v === '__none__' ? '' : v })
                }
              >
                <SelectTrigger className="h-10 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:h-9">
                  <SelectValue placeholder="Sin ubicación" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin ubicación
                  </SelectItem>
                  {(() => {
                    const slots = [...MUEBLE_SLOTS];
                    const cur = (formData.ubicacionFisica ?? '').trim();
                    if (cur && !slots.includes(cur)) slots.unshift(cur);
                    return slots.map((slot) => (
                      <SelectItem key={slot} value={slot} className="text-slate-900 dark:text-slate-100">
                        Mueble {slot}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 lg:leading-tight">
                Estante donde está el producto físicamente (A, A1, U2, …).
              </p>
            </div>
          </div>

          <DialogFooter className="flex shrink-0 flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/80 sm:flex-row sm:flex-wrap sm:justify-end lg:pt-2">
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
              className="bg-brand-gradient text-white"
            >
              Guardar y cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addTemplateLlegadaOpen}
        onOpenChange={(o) => {
          setAddTemplateLlegadaOpen(o);
          if (!o) {
            setAddTemplateLlegadaProduct(null);
            setAddTemplateLlegadaQtyStr('');
          }
        }}
      >
        <DialogContent
          useDialogDescription
          overlayClassName="z-[130] bg-black/55"
          className="z-[131] gap-3 border-slate-200 bg-slate-100 py-5 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md"
        >
          {addTemplateLlegadaProduct && addTemplateLlegadaMeta ? (
            <>
              <DialogHeader className="space-y-2 text-left">
                <DialogTitle className="text-base sm:text-lg">{addTemplateLlegadaMeta.titulo}</DialogTitle>
                <DialogDescription className="text-left text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {addTemplateLlegadaProduct.nombre}
                  </span>
                  <span className="text-slate-500"> · SKU {addTemplateLlegadaProduct.sku}</span>
                  <span className="mt-2 block text-xs leading-snug">
                    Existencia en plantilla:{' '}
                    <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">
                      {addTemplateLlegadaProduct.existencia}
                    </span>
                    . {addTemplateLlegadaMeta.descripcionAyuda}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="add-template-llegada-qty" className="text-sm text-slate-700 dark:text-slate-300">
                  {addTemplateLlegadaMeta.inputLabel}
                </Label>
                <Input
                  id="add-template-llegada-qty"
                  type="number"
                  inputMode={addTemplateLlegadaMeta.permitirDecimal ? 'decimal' : 'numeric'}
                  min={0}
                  step={addTemplateLlegadaMeta.permitirDecimal ? 'any' : 1}
                  autoFocus
                  value={addTemplateLlegadaQtyStr}
                  onChange={(e) => setAddTemplateLlegadaQtyStr(e.target.value)}
                  className="h-11 border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-500">
                  Deje en blanco o 0 si en esta recepción no suma cantidad (solo copiar datos del artículo).
                </p>
              </div>
              <DialogFooter className="gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 dark:border-slate-600"
                  onClick={() => {
                    setAddTemplateLlegadaOpen(false);
                    setAddTemplateLlegadaProduct(null);
                    setAddTemplateLlegadaQtyStr('');
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="bg-brand-gradient text-white"
                  onClick={() => confirmAddTemplateLlegada()}
                >
                  Aplicar plantilla
                </Button>
              </DialogFooter>
            </>
          ) : null}
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
          <div className="rounded-lg border border-brand/25 bg-brand/10 px-3 py-2.5">
            <p className="text-xs text-slate-600 dark:text-slate-400">Total compra (sin IVA)</p>
            <p className="text-xl font-bold tabular-nums text-brand-to dark:text-brand">
              {formatMoney(
                roundMoney2(addSessionSummaryLines.reduce((s, r) => s + r.subtotalSinIva, 0))
              )}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setAddSessionSummaryOpen(false)}
              className="bg-brand-gradient text-white"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ubicación física */}
      <Dialog
        open={ubicacionDialogProduct != null}
        onOpenChange={(open) => {
          if (!open) setUbicacionDialogProduct(null);
        }}
      >
        <DialogContent className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <MapPin className="h-5 w-5 shrink-0 text-brand dark:text-brand" aria-hidden />
              <span className="min-w-0 break-words">{ubicacionDialogProduct?.nombre ?? 'Ubicación'}</span>
            </DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Ubicación física
            </DialogDescription>
          </DialogHeader>
          {ubicacionDialogProduct ? (
            <div className="space-y-3 text-sm">
              <p className="font-mono text-slate-700 dark:text-slate-300">
                SKU: {ubicacionDialogProduct.sku}
              </p>
              {ubicacionDialogSlots.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                  Este producto aún no tiene ubicación física registrada.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Ubicación{ubicacionDialogSlots.length > 1 ? 'es' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ubicacionDialogSlots.map((slot) => (
                      <Badge
                        key={slot}
                        className="bg-brand/15 px-3 py-1 text-base font-semibold tabular-nums text-brand-to dark:text-brand"
                      >
                        {slot}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setUbicacionDialogProduct(null)}
              className="bg-brand-gradient text-white"
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
            setEditDialogView('edit');
            setProductHistorialMovs([]);
            setEditPrecioIvaMode('sin');
            setEditPreciosListaIvaMode('sin');
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
          {editDialogView === 'historial' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-slate-300 dark:border-slate-600"
                    onClick={() => setEditDialogView('edit')}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                  </Button>
                  <span>Historial del SKU</span>
                </DialogTitle>
                <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
                  Llegadas, salidas, ventas, ajustes y cambios de catálogo de este artículo.
                  {selectedProduct ? (
                    <span className="mt-1 block font-medium text-slate-800 dark:text-slate-200">
                      {selectedProduct.nombre}
                      <span className="font-normal text-slate-500"> · SKU {selectedProduct.sku}</span>
                    </span>
                  ) : null}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-[14rem] py-2">
                {productHistorialLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                    ))}
                  </div>
                ) : productHistorialMovs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600 dark:text-slate-500">
                    <Clock className="mb-2 h-10 w-10 opacity-50" />
                    <p className="text-sm">No hay movimientos registrados para este SKU</p>
                  </div>
                ) : (
                  <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800/70">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                          <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            Fecha y hora
                          </TableHead>
                          <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Tipo</TableHead>
                          <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                            Antes
                          </TableHead>
                          <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                            Después
                          </TableHead>
                          <TableHead className="min-w-[6rem] text-slate-600 dark:text-slate-400">Proveedor</TableHead>
                          <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                            P. compra
                          </TableHead>
                          <TableHead className="min-w-[8rem] text-slate-600 dark:text-slate-400">Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {productHistorialMovs.map((mov) => {
                          const when = mov.createdAt instanceof Date ? mov.createdAt : new Date(mov.createdAt);
                          const motivo = mov.motivo?.trim() || '—';
                          const pu = mov.precioUnitarioCompra;
                          const cat = isCatalogInventoryMovement(mov.tipo);
                          return (
                            <TableRow
                              key={mov.id}
                              className="border-slate-200 dark:border-slate-800/80 hover:bg-slate-200/40 dark:hover:bg-slate-800/30"
                            >
                              <TableCell className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                                {formatInAppTimezone(when, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                                {tipoMovimientoLabel(mov.tipo)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-800 dark:text-slate-200">
                                {cat ? '—' : mov.cantidadAnterior}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums font-medium text-brand dark:text-brand">
                                {cat ? '—' : mov.cantidadNueva}
                              </TableCell>
                              <TableCell className="max-w-[12rem] text-xs text-slate-700 dark:text-slate-300">
                                {cat
                                  ? '—'
                                  : formatProveedorHistorialLineaResuelto(
                                      mov.proveedor,
                                      mov.proveedorCodigo,
                                      proveedoresLista
                                    ) || '—'}
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialogView('edit')}
                  className="border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                >
                  Volver a editar
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowEditDialog(false)}
                  className="bg-brand-gradient text-white"
                >
                  Cerrar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
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
            <div className="col-span-2 flex flex-col gap-2 border-b border-slate-200/80 pb-3 dark:border-slate-700/80 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Precios de venta y compra (elija cómo capturarlos)
              </p>
              <InventarioPrecioIvaModeToggle value={editPrecioIvaMode} onChange={setEditPrecioIvaMode} />
            </div>
            <div className="space-y-2">
              <Label>
                {editPrecioIvaMode === 'con' ? 'Precio de venta (con IVA) *' : 'Precio de venta (sin IVA) *'}
              </Label>
              <InventarioStoredMoneyInput
                min={0}
                step="any"
                storedSinIva={formData.precioVenta}
                onStoredSinIvaChange={(n) => {
                  setFormData((d) => ({ ...d, precioVenta: n }));
                  cascadeListasFromPrecioVenta(n, formData.impuesto, editListaStorageIncluyeIva);
                }}
                ivaMode={editPrecioIvaMode}
                impuestoPct={formData.impuesto}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                {formData.precioVenta > 0 ? (
                  editPrecioIvaMode === 'sin' ? (
                    <>
                      Con IVA ({formData.impuesto}%):{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatMoney(precioVentaSinIvaToConIva(formData.precioVenta, formData.impuesto))}
                      </span>
                      . Se guarda en catálogo el precio sin IVA.
                    </>
                  ) : (
                    <>
                      Sin IVA:{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatMoney(formData.precioVenta)}
                      </span>
                      . El catálogo guarda siempre la base sin impuesto.
                    </>
                  )
                ) : editPrecioIvaMode === 'sin' ? (
                  <>
                    Ingrese el precio base sin impuesto; el sistema calcula el precio con IVA (tasa {formData.impuesto}
                    %).
                  </>
                ) : (
                  <>
                    Ingrese el precio al público con IVA; el sistema guarda la base sin impuesto (tasa{' '}
                    {formData.impuesto}%).
                  </>
                )}
                {formData.precioVenta > 0 ? (
                  <>
                    {' '}
                    Al cambiar este precio solo se actualiza la lista <span className="font-medium">Regular</span>;
                    las demás listas conservan su valor.
                  </>
                ) : null}
              </p>
            </div>
            <div className="space-y-2">
              <Label>
                {editPrecioIvaMode === 'con' ? 'Precio de compra (con IVA)' : 'Precio de compra (sin IVA)'}
              </Label>
              <InventarioStoredMoneyInput
                min={0}
                step="any"
                storedSinIva={formData.precioCompra}
                onStoredSinIvaChange={(n) => setFormData((d) => ({ ...d, precioCompra: n }))}
                ivaMode={editPrecioIvaMode}
                impuestoPct={formData.impuesto}
                className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {editPrecioIvaMode === 'sin' ? (
                  'Precio unitario de compra sin impuesto.'
                ) : formData.precioCompra > 0 ? (
                  <>
                    Equiv. sin IVA:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatMoney(formData.precioCompra)}
                    </span>
                    . Se guarda en catálogo sin impuesto.
                  </>
                ) : (
                  'Ingrese el costo unitario con IVA incluido; se guarda la base sin impuesto.'
                )}
              </p>
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
              <Label>Ubicación física (mueble)</Label>
              <Select
                value={formData.ubicacionFisica || '__none__'}
                onValueChange={(v) => {
                  const next = v === '__none__' ? '' : v;
                  const current = (formData.ubicacionFisica ?? '').trim();
                  if (next === current) return;

                  const fromMap = selectedProduct
                    ? getUbicacionesProducto(selectedProduct.sku, selectedProduct.codigoBarras)
                    : [];
                  const previousSlots = [
                    ...new Set([...fromMap, ...(current ? [current] : [])]),
                  ].filter((slot) => slot !== next);

                  if (next && previousSlots.length > 0) {
                    setUbicacionReplaceConfirm({ next, previousSlots });
                    return;
                  }

                  setFormData({ ...formData, ubicacionFisica: next });
                }}
              >
                <SelectTrigger className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <SelectValue placeholder="Sin ubicación" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Sin ubicación
                  </SelectItem>
                  {(() => {
                    const slots = [...MUEBLE_SLOTS];
                    const cur = (formData.ubicacionFisica ?? '').trim();
                    if (cur && !slots.includes(cur)) slots.unshift(cur);
                    return slots.map((slot) => (
                      <SelectItem key={slot} value={slot} className="text-slate-900 dark:text-slate-100">
                        Mueble {slot}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                Al cambiar de estante se pedirá confirmar si eliminas el anterior; la ubicación
                guardada es la que se muestra en POS e inventario.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label>Proveedor</Label>
                  <Select
                    value={
                      formData.proveedor?.trim()
                        ? normalizeProveedorNombreGuardado(formData.proveedor) || '__none__'
                        : '__none__'
                    }
                    onValueChange={(v) =>
                      setFormData({ ...formData, proveedor: v === '__none__' ? '' : v })
                    }
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
                      {proveedorOptionsForEditSelect.map((c) => (
                        <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                          {proveedorSelectItemLabel(c, proveedorNombreMapForm)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full shrink-0 space-y-2 sm:w-44">
                  <Label className="text-slate-600 dark:text-slate-400">Buscar (código o nombre)</Label>
                  <Input
                    value={editProveedorFilter}
                    onChange={(e) => setEditProveedorFilter(upperTxt(e.target.value))}
                    placeholder="Ej. PRV01"
                    autoComplete="off"
                    className="h-10 border-slate-300 bg-slate-200 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-slate-300 dark:border-slate-600"
                onClick={() => setEditDialogView('historial')}
              >
                <History className="h-4 w-4 shrink-0" />
                Historial
              </Button>
            </div>
            {editPreciosSectionOpen ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium leading-snug text-slate-600 dark:text-slate-400 [text-wrap:balance]">
                      Precios opcionales por tipo de cliente
                    </p>
                    <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 [text-wrap:pretty]">
                      Si deja vacío, en el POS se usa el precio de venta con el % de la lista en Configuración →
                      Precios{'\u00a0'}por{'\u00a0'}cliente. Use el interruptor para capturar con IVA o sin IVA; el
                      catálogo sigue su configuración (listas con o sin IVA incluido).
                    </p>
                  </div>
                  <InventarioPrecioIvaModeToggle
                    value={editPreciosListaIvaMode}
                    onChange={setEditPreciosListaIvaMode}
                    className="self-start sm:mt-0.5"
                  />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-500">
                  Modo de captura:{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {editPreciosListaIvaMode === 'con' ? 'con IVA' : 'sin IVA'}
                  </span>
                  . En base de datos las listas están como{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {editListaStorageIncluyeIva ? 'importe con IVA' : 'importe sin IVA'}
                  </span>
                  .
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {priceListCatalog.entries.map(({ id, label }) => (
                    <div key={id} className="space-y-1">
                      <Label className="text-xs text-slate-600 dark:text-slate-400">
                        {label}
                      </Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={
                          listasPrecioMainDraft[id] !== undefined
                            ? listasPrecioMainDraft[id]!
                            : convertListaPrecioStrForDisplay(
                                preciosListaStr[id],
                                editListaStorageIncluyeIva,
                                editPreciosListaIvaMode === 'con',
                                formData.impuesto
                              )
                        }
                        onFocus={() => {
                          setListasPrecioMainDraft((prev) => ({
                            ...prev,
                            [id]: convertListaPrecioStrForDisplay(
                              preciosListaStr[id],
                              editListaStorageIncluyeIva,
                              editPreciosListaIvaMode === 'con',
                              formData.impuesto
                            ),
                          }));
                        }}
                        onChange={(e) =>
                          setListasPrecioMainDraft((prev) => ({
                            ...prev,
                            [id]: sanitizeListaPrecioDraft(e.target.value),
                          }))
                        }
                        onBlur={() => {
                          const raw = listasPrecioMainDraft[id];
                          if (raw === undefined) return;
                          setPreciosListaStr((prev) => ({
                            ...prev,
                            [id]: convertListaPrecioInputToStorage(
                              raw,
                              editListaStorageIncluyeIva,
                              editPreciosListaIvaMode === 'con',
                              formData.impuesto
                            ),
                          }));
                          setListasPrecioMainDraft((prev) => {
                            const next = { ...prev };
                            delete next[id];
                            return next;
                          });
                        }}
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
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label>Proveedor</Label>
                      <Select
                        value={
                          stockAdjustment.proveedorEntrada.trim()
                            ? normalizeProveedorNombreGuardado(stockAdjustment.proveedorEntrada) || '__none__'
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
                          {stockProveedorOptionsForSelect.map((c) => (
                            <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                              {proveedorSelectItemLabel(c, stockProveedorNombreMap)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full shrink-0 space-y-2 sm:w-44">
                      <Label className="text-slate-600 dark:text-slate-400">Buscar (código o nombre)</Label>
                      <Input
                        value={stockProveedorFilter}
                        onChange={(e) => setStockProveedorFilter(upperTxt(e.target.value))}
                        placeholder="Ej. PRV01"
                        autoComplete="off"
                        className="h-10 border-slate-300 bg-slate-200 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    {editPrecioIvaMode === 'con'
                      ? 'Precio unitario de compra (con IVA)'
                      : 'Precio unitario de compra (sin IVA)'}
                  </Label>
                  <InventarioStoredMoneyInput
                    min={0}
                    step="any"
                    storedSinIva={stockAdjustment.precioCompraUnit}
                    onStoredSinIvaChange={(n) =>
                      setStockAdjustment((st) => ({ ...st, precioCompraUnit: n }))
                    }
                    ivaMode={editPrecioIvaMode}
                    impuestoPct={formData.impuesto}
                    className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-500">
                    {editPrecioIvaMode === 'sin' ? (
                      'Opcional (sin IVA). Se guarda en el historial de Configuración → Abasto.'
                    ) : stockAdjustment.precioCompraUnit > 0 ? (
                      <>
                        Equiv. sin IVA:{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {formatMoney(stockAdjustment.precioCompraUnit)}
                        </span>
                        . Se registra sin impuesto en abasto.
                      </>
                    ) : (
                      'Opcional. Capture con IVA; se guarda la base sin impuesto en el historial de abasto.'
                    )}
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
              className="bg-brand-gradient text-white"
            >
              Actualizar Producto
            </Button>
          </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={preciosDialogOpen}
        onOpenChange={(open) => {
          setPreciosDialogOpen(open);
          if (!open) {
            setPreciosDialogProduct(null);
            setPreciosDialogListaStr(emptyPreciosListaStr());
            setPreciosDialogListaIvaMode('sin');
            setListasPrecioDialogDraft({});
          }
        }}
      >
        <DialogContent className="flex max-h-[min(92dvh,44rem)] w-full min-w-0 max-w-[min(96vw,44rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-800/80">
            <DialogTitle>Precios por lista e historial</DialogTitle>
            {preciosDialogProduct ? (
              <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{preciosDialogProduct.nombre}</span>
                <span className="text-slate-500"> · SKU {preciosDialogProduct.sku}</span>
              </DialogDescription>
            ) : null}
            {preciosDialogProduct ? (
              <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/80 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500">
                  Vista de importes: listas de cliente y costo de compra (el catálogo sigue guardando compra sin IVA).
                </p>
                <InventarioPrecioIvaModeToggle
                  value={preciosDialogListaIvaMode}
                  onChange={setPreciosDialogListaIvaMode}
                  disabled={preciosDialogSaving}
                  className="self-start sm:self-center"
                />
              </div>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-200/50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  Precios por tipo de cliente
                </p>
                <InventarioPrecioIvaModeToggle
                  value={preciosDialogListaIvaMode}
                  onChange={setPreciosDialogListaIvaMode}
                  disabled={preciosDialogSaving}
                  className="self-start"
                />
              </div>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 [text-wrap:pretty]">
                Si deja vacío un campo, en el POS se usa el precio de venta del artículo con el % de la lista en
                Configuración → Precios por cliente. Use el interruptor para ver o capturar con IVA o sin IVA; en base de
                datos las listas siguen guardadas como{' '}
                <span className="font-medium">
                  {preciosDialogListaStorageIncluyeIva ? 'importe con IVA' : 'importe sin IVA'}
                </span>
                . Si importó desde Excel con columnas “Mayoreo +”, “Mayoreo -”, etc., el sistema las reconoce.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {priceListCatalog.entries.map(({ id, label }) => (
                  <div key={id} className="space-y-1">
                    <Label className="text-xs text-slate-600 dark:text-slate-400">
                      {label}
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="—"
                      disabled={preciosDialogSaving}
                      value={
                        listasPrecioDialogDraft[id] !== undefined
                          ? listasPrecioDialogDraft[id]!
                          : convertListaPrecioStrForDisplay(
                              preciosDialogListaStr[id],
                              preciosDialogListaStorageIncluyeIva,
                              preciosDialogListaIvaMode === 'con',
                              preciosDialogProduct?.impuesto ?? 16
                            )
                      }
                      onFocus={() => {
                        setListasPrecioDialogDraft((prev) => ({
                          ...prev,
                          [id]: convertListaPrecioStrForDisplay(
                            preciosDialogListaStr[id],
                            preciosDialogListaStorageIncluyeIva,
                            preciosDialogListaIvaMode === 'con',
                            preciosDialogProduct?.impuesto ?? 16
                          ),
                        }));
                      }}
                      onChange={(e) =>
                        setListasPrecioDialogDraft((prev) => ({
                          ...prev,
                          [id]: sanitizeListaPrecioDraft(e.target.value),
                        }))
                      }
                      onBlur={() => {
                        const raw = listasPrecioDialogDraft[id];
                        if (raw === undefined) return;
                        setPreciosDialogListaStr((prev) => ({
                          ...prev,
                          [id]: convertListaPrecioInputToStorage(
                            raw,
                            preciosDialogListaStorageIncluyeIva,
                            preciosDialogListaIvaMode === 'con',
                            preciosDialogProduct?.impuesto ?? 16
                          ),
                        }));
                        setListasPrecioDialogDraft((prev) => {
                          const next = { ...prev };
                          delete next[id];
                          return next;
                        });
                      }}
                      className="h-9 border-slate-300 dark:border-slate-700 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-4 space-y-3 rounded-lg border border-brand/25 bg-brand/10 p-3 dark:border-brand/30 dark:bg-brand/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-to dark:text-brand">
                Precio de compra
              </p>
              <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {preciosDialogProduct != null &&
                preciosDialogProduct.precioCompra != null &&
                Number.isFinite(Number(preciosDialogProduct.precioCompra))
                  ? preciosDialogListaIvaMode === 'con'
                    ? formatMoney(
                        precioVentaSinIvaToConIva(
                          Number(preciosDialogProduct.precioCompra),
                          preciosDialogProduct.impuesto ?? 16
                        )
                      )
                    : formatMoney(Number(preciosDialogProduct.precioCompra))
                  : '—'}
              </p>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-500 [text-wrap:pretty]">
                Costo unitario en catálogo se guarda <span className="font-medium">sin IVA</span>
                {preciosDialogProduct != null &&
                preciosDialogProduct.precioCompra != null &&
                Number.isFinite(Number(preciosDialogProduct.precioCompra)) &&
                preciosDialogListaIvaMode === 'con' ? (
                  <>
                    . Equiv. sin IVA:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatMoney(Number(preciosDialogProduct.precioCompra))}
                    </span>
                  </>
                ) : null}
                . El {preciosDialogProduct?.impuesto ?? 16}% de IVA del artículo aplica a la venta al público, no a este
                costo. Actualícelo al editar el producto o al registrar entradas con precio de compra.
              </p>
            </div>

            <div className="mt-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Historial de llegadas (entradas / compras)
              </p>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-500">
                Solo filas donde hubo llegada de mercancía (se capturó proveedor y/o precio unitario de compra sin
                IVA al registrar la entrada).
              </p>
              {productEntradasHistLoading ? (
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                  ))}
                </div>
              ) : productEntradasHist.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-200/40 px-3 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                  No hay llegadas de mercancía para este artículo (entradas con proveedor o precio de compra
                  capturado).
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
                            <TableCell className="text-right text-sm font-medium tabular-nums text-brand dark:text-brand">
                              +{mov.cantidad}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-slate-700 dark:text-slate-300">
                              {pu != null && Number.isFinite(pu) ? formatMoney(pu) : '—'}
                            </TableCell>
                            <TableCell className="max-w-[14rem] text-xs text-slate-700 dark:text-slate-300">
                              {formatProveedorHistorialLineaResuelto(
                                mov.proveedor,
                                mov.proveedorCodigo,
                                proveedoresLista
                              ) || '—'}
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
          <DialogFooter className="shrink-0 flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:justify-end dark:border-slate-800/80">
            <Button
              type="button"
              variant="outline"
              disabled={preciosDialogSaving}
              onClick={() => {
                setPreciosDialogOpen(false);
                setPreciosDialogProduct(null);
                setPreciosDialogListaStr(emptyPreciosListaStr());
              }}
              className="border-slate-300 dark:border-slate-600"
            >
              Cerrar
            </Button>
            <Button
              type="button"
              disabled={!preciosDialogProduct || preciosDialogSaving}
              onClick={() => void handleSavePreciosDialog()}
              className="bg-brand-gradient text-white"
            >
              {preciosDialogSaving ? 'Guardando…' : 'Guardar precios'}
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
                          <TableCell className="whitespace-nowrap text-right tabular-nums font-medium text-brand dark:text-brand">
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
                          <TableCell className="max-w-[12rem] text-xs text-slate-700 dark:text-slate-300">
                            {cat
                              ? '—'
                              : formatProveedorHistorialLineaResuelto(
                                  mov.proveedor,
                                  mov.proveedorCodigo,
                                  proveedoresLista
                                ) || '—'}
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

      <AlertDialog
        open={ubicacionReplaceConfirm != null}
        onOpenChange={(open) => {
          if (!open) setUbicacionReplaceConfirm(null);
        }}
      >
        <AlertDialogContent className="z-[320] border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el estante anterior?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              {ubicacionReplaceConfirm ? (
                <>
                  Este artículo aparece en{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {ubicacionReplaceConfirm.previousSlots.join(', ')}
                  </span>
                  . Si confirmas, solo quedará registrado en{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {ubicacionReplaceConfirm.next}
                  </span>
                  .
                </>
              ) : (
                'Se reemplazará la ubicación física anterior.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-brand text-white hover:bg-brand-to"
              onClick={(e) => {
                e.preventDefault();
                if (!ubicacionReplaceConfirm) return;
                setFormData((prev) => ({
                  ...prev,
                  ubicacionFisica: ubicacionReplaceConfirm.next,
                }));
                setUbicacionReplaceConfirm(null);
              }}
            >
              Sí, solo {ubicacionReplaceConfirm?.next ?? 'nuevo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteProductTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteProductTarget(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este producto?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              {deleteProductTarget
                ? `Se dará de baja «${deleteProductTarget.nombre}» (SKU ${deleteProductTarget.sku}).`
                : 'Se dará de baja el producto seleccionado.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deletingProduct}
              className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingProduct}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteProduct();
              }}
            >
              {deletingProduct ? 'Eliminando…' : 'Sí, eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={managerAuthOpen}
        onOpenChange={(open) => {
          if (!open) closeManagerAuthDialog();
        }}
      >
        <DialogContent
          className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Autorización requerida</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Ingrese la contraseña de administrador o gerente para modificar el inventario.
            </p>
            <Input
              ref={managerAuthPinRef}
              type="password"
              autoComplete="off"
              placeholder="Contraseña"
              value={managerAuthPin}
              onChange={(e) => setManagerAuthPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmManagerAuthPin();
                }
              }}
              className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeManagerAuthDialog}>
                Cancelar
              </Button>
              <Button type="button" onClick={confirmManagerAuthPin}>
                Continuar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
