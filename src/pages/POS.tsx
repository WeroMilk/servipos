import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
  ScanLine,
  Plus,
  Minus,
  Trash2,
  Pencil,
  ShoppingCart,
  Receipt,
  X,
  Check,
  Printer,
  Percent,
  User,
  Wallet,
  Clock,
  ClipboardCheck,
  ClipboardList,
  Eye,
  MapPin,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { scheduleBarcodeScannerAutofocus } from '@/lib/scannerCameraFocus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useShallow } from 'zustand/react/shallow';
import { useCartStore, useAppStore, useAuthStore, useInventoryListsStore } from '@/stores';
import {
  setCajaPosHeaderBridge,
  clearCajaPosHeaderBridge,
  type ModificarSaldoKind,
} from '@/stores/cajaPosHeaderStore';
import {
  setVentasAbiertasPosHeaderBridge,
  clearVentasAbiertasPosHeaderBridge,
} from '@/stores/ventasAbiertasPosHeaderStore';
import { useProductSearch, useSales, useClients, useEffectiveSucursalId, useCajaSesion } from '@/hooks';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePosCartCloudSync } from '@/hooks/usePosCartCloudSync';
import { CajaPosToolbar, type CajaPosToolbarHandle } from '@/components/caja/CajaPosToolbar';
import {
  UbicacionFisicaContent,
  UbicacionFisicaNombre,
} from '@/components/products/UbicacionFisicaNombre';
import { resolveUbicacionesProducto } from '@/data/ubicacionesMuebleA';
import type {
  Client,
  Product,
  FormaPago,
  Payment,
  Sale,
  SaleItem,
  Sucursal,
  CartItem,
  QuotationItem,
} from '@/types';
import { FORMAS_PAGO_UI } from '@/types';
import {
  getSaleByFolio,
  getSaleById,
  getClientById,
  getProductById,
  findQuotationByLast4Folio,
  markQuotationConvertedWithSale,
  markQuotationConvertedWithSaleFromCompletedSale,
  unlinkQuotationFromCancelledSale,
  updatePendingOpenSale,
  updateProduct,
} from '@/db/database';
import { getSaleByIdFirestore } from '@/lib/firestore/salesFirestore';
import { registrarAbonoCobroCajaFirestore } from '@/lib/firestore/cajaFirestore';
import { getProductCatalogSnapshot, updateProductFirestore } from '@/lib/firestore/productsFirestore';
import { commitEmptyPosCartDraft } from '@/lib/firestore/posCartDraftFirestore';
import { subscribePromotionsCatalog } from '@/lib/firestore/promotionsFirestore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';
import { parsePrecioNumberFromFirestore, resolvePrecioVentaSinIvaForDoc } from '@/lib/precioListaNorm';
import {
  buildPendingSaleLineItemsFromCart,
  clientFromSaleForPos,
  parseResumeListaPreciosId,
} from '@/lib/posOpenSaleResume';
import { clientFromQuotationForPos } from '@/lib/posQuotationCart';
import {
  type ClientPriceListId,
  POS_EDIT_UNIT_PRICE_PIN,
} from '@/lib/clientPriceLists';
import {
  getClientPriceListCatalogFromStore,
  normalizeClientPriceListIdWithExtras,
} from '@/lib/clientPriceListCatalog';
import { useClientPriceListCatalog } from '@/hooks/useClientPriceListCatalog';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { printThermalTicket, printThermalClientCreditoReceipt } from '@/lib/printTicket';
import { labelCreditoTiendaMotivo } from '@/lib/clientCreditoTienda';
import {
  getCartLineUnitSinIvaBase,
  getProductIvaUnitarioDesdeSinIva,
  getProductUnitConIvaForClienteList,
  getProductUnitSinIvaForClienteList,
} from '@/lib/productListPricing';
import { productEsServicio } from '@/lib/productServicio';
import {
  isPosGenericClienteNombre,
  POS_GENERIC_CLIENT_ID,
  POS_GENERIC_CLIENT_LABEL,
  posClienteDisplayNombre,
} from '@/lib/posDefaultCliente';
import {
  abrevCantidadVentaPorUnidadSat,
  deltaCantidadBotonMasMenosSat,
  formatearCantidadLineaVentaSat,
  normalizeClaveUnidadSat,
  snapCantidadLineaVenta,
} from '@/lib/satCatalog';
import {
  buildDevolucionTicketLineas,
  previewReembolsoDevolucion,
  type DevolucionLineInput,
} from '@/lib/salePartialReturnCompute';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { saldoCreditoCliente, sumCreditoTiendaEnPagosParcial } from '@/lib/clientCreditoTienda';

function buildProductStubFromResumeFields(args: {
  productId: string;
  nombreHint?: string;
  precioUnitario: number;
  impuesto: number;
  unidadMedida?: string;
  claveProdServ?: string;
}): Product {
  const epoch = new Date(0);
  const base = args.nombreHint?.trim() || 'Artículo';
  return {
    id: args.productId,
    sku: '—',
    nombre: `${base} (fuera de catálogo)`,
    precioVenta: Number(args.precioUnitario) || 0,
    impuesto: Number.isFinite(args.impuesto) ? args.impuesto : 16,
    existencia: 0,
    existenciaMinima: 0,
    unidadMedida: args.unidadMedida?.trim() || 'H87',
    claveProdServ: args.claveProdServ,
    activo: false,
    createdAt: epoch,
    updatedAt: epoch,
    syncStatus: 'pending',
  };
}

/** Catálogo actual, producto embebido en el ticket o sustituto mínimo para poder cobrar. */
function productFromSaleLineForResume(line: SaleItem, fromCatalog: Product | undefined): Product {
  if (fromCatalog) return fromCatalog;
  if (line.producto?.id === line.productId) return line.producto;
  return buildProductStubFromResumeFields({
    productId: line.productId,
    nombreHint: line.producto?.nombre || line.productoNombre,
    precioUnitario: line.precioUnitario,
    impuesto: line.impuesto,
    unidadMedida: line.producto?.unidadMedida,
    claveProdServ: line.producto?.claveProdServ,
  });
}

function productFromQuotationLineForResume(line: QuotationItem, fromCatalog: Product | undefined): Product {
  if (fromCatalog) return fromCatalog;
  if (line.producto?.id === line.productId) return line.producto;
  return buildProductStubFromResumeFields({
    productId: line.productId,
    nombreHint: line.producto?.nombre,
    precioUnitario: line.precioUnitario,
    impuesto: line.impuesto,
    unidadMedida: line.producto?.unidadMedida,
    claveProdServ: line.producto?.claveProdServ,
  });
}

// ============================================
// PUNTO DE VENTA (POS) — Vista tipo app: lg+ sin scroll del contenedor (solo carrito / panel cobro); móvil conserva scroll vertical.
// ============================================

/** Cantidad opcional al inicio: `10*`, `2,5*` o `2.5*` + código o nombre (piezas siguen entrando como entero tras snap). */
function parsePosQuantityPrefix(raw: string): {
  quantity: number;
  rest: string;
  hadQtyPrefix: boolean;
} {
  const t = raw.trim();
  const m = t.match(/^([0-9]+(?:[.,][0-9]+)?)\*\s*(.*)$/);
  if (!m) return { quantity: 1, rest: t, hadQtyPrefix: false };
  const n = parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return { quantity: 1, rest: t, hadQtyPrefix: false };
  return {
    quantity: Math.min(999999, n),
    rest: (m[2] ?? '').trim(),
    hadQtyPrefix: true,
  };
}

/** Texto enviado al buscador de productos (sin prefijo `N*`). */
function posSearchEffectiveQuery(rawTrim: string): string {
  const p = parsePosQuantityPrefix(rawTrim);
  return p.hadQtyPrefix ? p.rest : rawTrim;
}

/**
 * Texto que puede ser SKU/código de barras (no nombre con espacios).
 * El auto-envío por silencio corto solo aplica si además la secuencia de teclas fue una ráfaga (pistola), no tipeo manual.
 */
function looksLikePosScanToken(s: string): boolean {
  const { rest } = parsePosQuantityPrefix(s);
  const t = rest.trim();
  if (!t) return false;
  if (t.length < 4 || /\s/.test(t)) return false;
  if (/^\d{8,}$/.test(t)) return true;
  if (/^\d{4,}$/.test(t)) return true;
  if (t.length >= 5 && /^[A-Z0-9.\-_]+$/i.test(t)) return true;
  return false;
}

/** Escape no debe cerrar el POS si el usuario está cerrando un desplegable Radix (p. ej. forma de pago). */
function isEventFromOpenRadixSelect(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('[data-slot="select-content"]'));
}

const POS_SCAN_IDLE_MS = 42;
/** Si entre dos teclas pasa más que esto, es tipeo manual (no disparamos auto-envío al silencio). */
const POS_SEARCH_SLOW_KEY_GAP_MS = 65;
/** Máx. duración primera→última tecla para considerar un código leído de una vez (pistola / pegado rápido). */
const POS_SEARCH_MAX_SCAN_BURST_SPAN_MS = 1400;

function cartLineUnitSinIva(item: CartItem, listaId: ClientPriceListId): number {
  const u = getCartLineUnitSinIvaBase(item, listaId);
  return u * (1 - (Number(item.discount) || 0) / 100);
}

function cartLineTotalConIva(item: CartItem, listaId: ClientPriceListId): number {
  const imp = Number(item.product.impuesto) || 16;
  return cartLineUnitSinIva(item, listaId) * item.quantity * (1 + imp / 100);
}

function filterClientesRegistrados(clients: Client[], search: string): Client[] {
  const q = search.trim().toLowerCase();
  return clients.filter((c) => {
    if (c.isMostrador || c.id === 'mostrador') return false;
    if (!q) return true;
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.rfc?.toLowerCase().includes(q) ?? false)
    );
  });
}

function resolveCheckoutClienteNombre(
  checkoutClienteNombre: string,
  client: Client | null,
  fallbackSaleCliente?: Client | null
): string {
  const typed = checkoutClienteNombre.trim();
  if (typed) return typed;
  if (client?.nombre?.trim() && !client.isMostrador && client.id !== 'mostrador') {
    return client.nombre.trim();
  }
  const fromSale = fallbackSaleCliente?.nombre?.trim();
  if (fromSale && !isPosGenericClienteNombre(fromSale)) return fromSale;
  return POS_GENERIC_CLIENT_LABEL;
}

function buildClienteSnapshotParaVenta(
  checkoutClienteNombre: string,
  client: Client | null,
  fallbackSaleCliente?: Client | null
): { clienteId: string; cliente?: Client } {
  const nombre = resolveCheckoutClienteNombre(checkoutClienteNombre, client, fallbackSaleCliente);
  const registrado =
    Boolean(client?.id) && client!.id !== 'mostrador' && !client!.isMostrador;
  if (registrado) {
    return {
      clienteId: client!.id,
      cliente: { ...client!, nombre },
    };
  }
  if (isPosGenericClienteNombre(nombre)) {
    return { clienteId: POS_GENERIC_CLIENT_ID };
  }
  return {
    clienteId: POS_GENERIC_CLIENT_ID,
    cliente: {
      id: POS_GENERIC_CLIENT_ID,
      nombre,
      isMostrador: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      syncStatus: 'synced',
    },
  };
}

/** SKU y existencia en la línea del carrito (servicios sin stock). */
function CartLineSkuStockText({ product }: { product: Product }) {
  const skuLabel = `SKU ${product.sku}`;
  if (productEsServicio(product)) return <>{skuLabel}</>;
  const qty = Number(product.existencia);
  const existencia = Number.isFinite(qty) ? qty : 0;
  if (existencia <= 0) {
    return (
      <>
        {skuLabel} - Unidades:{' '}
        <span className="font-semibold text-red-600 dark:text-red-400">AGOTADO</span>
      </>
    );
  }
  return (
    <>
      {skuLabel} - Unidades: {existencia}
    </>
  );
}

/** Precio unitario base (catálogo/override, antes de desc. línea) mostrado al usuario con IVA. */
function unitBaseSinIvaToPrecioConIva(baseSinIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  return baseSinIva * (1 + imp / 100);
}

function precioConIvaToUnitBaseSinIva(precioConIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  return precioConIva / (1 + imp / 100);
}

/** Valor a persistir en `preciosPorListaCliente` según bandera del producto/sucursal. */
function listaPrecioDialogInputToStoredValue(
  inputValue: number,
  inputEsConIva: boolean,
  almacenConIva: boolean,
  impuestoPct: number
): number {
  if (inputEsConIva === almacenConIva) return roundMoney2(inputValue);
  if (inputEsConIva && !almacenConIva) {
    return roundMoney2(precioConIvaToUnitBaseSinIva(inputValue, impuestoPct));
  }
  return roundMoney2(unitBaseSinIvaToPrecioConIva(inputValue, impuestoPct));
}

function emptyListaPrecioStrMap(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const id of getClientPriceListCatalogFromStore().ids) o[id] = '';
  return o;
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function applyListaPrecioCatalogStrChange(
  prev: Record<ClientPriceListId, string>,
  listId: ClientPriceListId,
  raw: string
): Record<ClientPriceListId, string> {
  return { ...prev, [listId]: raw };
}

type MobileTab = 'cart' | 'checkout';

type CheckoutPhase = 'payment' | 'success';

/** Datos de la venta recién cobrada: el carrito se vacía al completar; el ticket y el modal usan esto. */
type PosTicketSnapshot = {
  clienteNombre: string;
  cajeroNombre?: string;
  lineas: {
    descripcion: string;
    cantidad: number;
    precioUnit: number;
    total: number;
  }[];
  subtotal: number;
  impuestos: number;
  total: number;
  cambio: number;
  /** Importe que quedó a cuenta del cliente (venta PPD con pago parcial o sin pago). */
  adeudoPendiente?: number;
  sucursalId?: string;
  /** Folio de venta (ej. V-YYYYMMDD-0001) para ticket y referencia al facturar. */
  folio?: string;
  notas?: string;
  resumenPagos?: { label: string; monto: number; ultimos4?: string }[];
  /** Comprobante de devolución (reembolso); no genera folio de venta nuevo. */
  modoDevolucion?: boolean;
  folioVentaOrigen?: string;
  /** true = solo parte del ticket; el folio original sigue activo con líneas restantes. */
  devolucionParcial?: boolean;
};

/** Imprime el ticket térmico con el snapshot ya construido (evita estado React desactualizado). */
function printPosTicketSnapshot(snap: PosTicketSnapshot) {
  if (snap.modoDevolucion) {
    printThermalTicket({
      negocio: 'SERVIPARTZ',
      sucursalId: snap.sucursalId,
      folio: snap.folioVentaOrigen,
      fecha: formatInAppTimezone(new Date(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      cliente: snap.clienteNombre,
      cajeroNombre: snap.cajeroNombre,
      lineas: snap.lineas,
      subtotal: snap.subtotal,
      impuestos: snap.impuestos,
      total: snap.total,
      cambio: 0,
      notas:
        snap.notas ??
        'COMPROBANTE DE DEVOLUCIÓN — El ticket original quedó cancelado por devolución.',
      resumenPagos: snap.resumenPagos,
      incluirPiePoliticasRefacciones: false,
    });
    return;
  }
  printThermalTicket({
    negocio: 'SERVIPARTZ',
    sucursalId: snap.sucursalId,
    folio: snap.folio,
    fecha: formatInAppTimezone(new Date(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    cliente: snap.clienteNombre,
    cajeroNombre: snap.cajeroNombre,
    lineas: snap.lineas,
    subtotal: snap.subtotal,
    impuestos: snap.impuestos,
    total: snap.total,
    cambio: snap.cambio,
    adeudoPendiente: snap.adeudoPendiente,
    notas: snap.notas,
    resumenPagos: snap.resumenPagos,
    incluirPiePoliticasRefacciones: true,
  });
}

export function POS() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const priceListCatalog = useClientPriceListCatalog();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const {
    addSale,
    sales: salesCatalog,
    completePendingSale,
    appendPagosToCompletedSale,
    cancelSale: ejecutarCancelacionVenta,
    partialReturnSale: ejecutarDevolucionParcial,
  } = useSales(500);
  /** Evita depender de `salesCatalog` en el efecto de deep link (re-ejecución = doble toast). */
  const salesCatalogNavRef = useRef(salesCatalog);
  salesCatalogNavRef.current = salesCatalog;
  const { effectiveSucursalId } = useEffectiveSucursalId();
  usePosCartCloudSync({ userId: user?.id, sucursalId: effectiveSucursalId });
  const cajaSesion = useCajaSesion({ sucursalId: effectiveSucursalId });
  const cajaToolbarRef = useRef<CajaPosToolbarHandle>(null);

  useEffect(() => {
    if (!hasPermission('ventas:crear')) {
      clearCajaPosHeaderBridge();
      return;
    }
    setCajaPosHeaderBridge({
      cajaAbierta: Boolean(cajaSesion.activa),
      loading: cajaSesion.loading,
      onToggle: () => {
        if (cajaSesion.loading) return;
        if (!cajaSesion.activa) cajaToolbarRef.current?.openAbrirCajaDialog();
        else cajaToolbarRef.current?.openCerrarCajaDialog();
      },
      modificarSaldoVisible: Boolean(cajaSesion.activa),
      onModificarSaldo: (kind: ModificarSaldoKind) =>
        cajaToolbarRef.current?.openModificarSaldoDialog(kind),
    });
    return () => clearCajaPosHeaderBridge();
  }, [hasPermission, cajaSesion.activa, cajaSesion.loading]);

  const [sucursalesCat, setSucursalesCat] = useState<Sucursal[]>([]);
  useEffect(() => subscribeSucursales(setSucursalesCat), []);

  const formasPagoPos = useMemo(() => {
    const base = [
      ...FORMAS_PAGO_UI,
      { clave: 'PPC' as const, descripcion: 'Pendiente de pago' },
      { clave: 'COT' as const, descripcion: 'Cotización' },
      { clave: 'DEV' as const, descripcion: 'Devolución' },
    ];
    if (isAdmin) {
      base.push({ clave: 'TTS', descripcion: 'Transferencia de tienda a tienda' });
    }
    return base;
  }, [isAdmin]);

  const otrasSucursales = useMemo(() => {
    const cur = effectiveSucursalId ?? '';
    return sucursalesCat.filter((s) => s.activo !== false && s.id !== cur);
  }, [sucursalesCat, effectiveSucursalId]);

  const cart = useCartStore(
    useShallow((s) => ({
      items: s.items,
      client: s.client,
      discount: s.discount,
      formaPago: s.formaPago,
      metodoPago: s.metodoPago,
      pagos: s.pagos,
      addItem: s.addItem,
      removeItem: s.removeItem,
      updateQuantity: s.updateQuantity,
      updateDiscount: s.updateDiscount,
      updateLineUnitPrice: s.updateLineUnitPrice,
      applyLinePrecioFromLista: s.applyLinePrecioFromLista,
      resetLinePrecioToTicketLista: s.resetLinePrecioToTicketLista,
      setGlobalDiscount: s.setGlobalDiscount,
      setFormaPago: s.setFormaPago,
      setMetodoPago: s.setMetodoPago,
      precioClienteListaId: s.precioClienteListaId,
      setPrecioClienteLista: s.setPrecioClienteLista,
      transferenciaDestinoSucursalId: s.transferenciaDestinoSucursalId,
      setTransferenciaDestinoSucursalId: s.setTransferenciaDestinoSucursalId,
      addPago: s.addPago,
      removePago: s.removePago,
      setClient: s.setClient,
      clearCart: s.clearCart,
      replaceCartForOpenSaleResume: s.replaceCartForOpenSaleResume,
      reapplyPromotions: s.reapplyPromotions,
      getSubtotal: s.getSubtotal,
      getImpuestos: s.getImpuestos,
      getDescuento: s.getDescuento,
      getTotal: s.getTotal,
      getTotalPagado: s.getTotalPagado,
      getCambio: s.getCambio,
    }))
  );

  const {
    items,
    client,
    discount,
    formaPago,
    metodoPago,
    pagos,
    addItem,
    removeItem,
    updateQuantity,
    updateDiscount,
    updateLineUnitPrice,
    applyLinePrecioFromLista,
    resetLinePrecioToTicketLista,
    setGlobalDiscount,
    setFormaPago,
    setMetodoPago,
    precioClienteListaId,
    setPrecioClienteLista,
    transferenciaDestinoSucursalId,
    setTransferenciaDestinoSucursalId,
    addPago,
    removePago,
    setClient,
    clearCart,
    replaceCartForOpenSaleResume,
    reapplyPromotions,
    getCambio,
  } = cart;

  useEffect(() => {
    const sid = effectiveSucursalId?.trim();
    if (!sid) return;
    return subscribePromotionsCatalog(sid, (rows) => {
      reapplyPromotions(rows);
    });
  }, [effectiveSucursalId, reapplyPromotions]);

  const ventasAbiertas = useMemo(
    () =>
      salesCatalog
        .filter((s) => s.estado === 'pendiente')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 40),
    [salesCatalog]
  );

  const [ventasAbiertasDialogOpen, setVentasAbiertasDialogOpen] = useState(false);
  const [pasarCxcBusyId, setPasarCxcBusyId] = useState<string | null>(null);
  const [pasarCxcClientePickerSale, setPasarCxcClientePickerSale] = useState<Sale | null>(null);
  const [pasarCxcClienteSearch, setPasarCxcClienteSearch] = useState('');

  useEffect(() => {
    if (pasarCxcClientePickerSale) setPasarCxcClienteSearch('');
  }, [pasarCxcClientePickerSale]);

  useEffect(() => {
    if (!hasPermission('ventas:crear')) {
      clearVentasAbiertasPosHeaderBridge();
      return;
    }
    setVentasAbiertasPosHeaderBridge({
      count: ventasAbiertas.length,
      onOpen: () => setVentasAbiertasDialogOpen(true),
    });
    return () => clearVentasAbiertasPosHeaderBridge();
  }, [hasPermission, ventasAbiertas]);

  const [openSaleResume, setOpenSaleResume] = useState<{ sale: Sale } | null>(null);
  const openSaleResumeRef = useRef<{ sale: Sale } | null>(null);
  openSaleResumeRef.current = openSaleResume;
  const [dejarAbiertaBusy, setDejarAbiertaBusy] = useState(false);
  const [resumeOpenBusy, setResumeOpenBusy] = useState(false);

  const persistOpenSaleEdits = useCallback(async (): Promise<Sale | null> => {
    const resume = openSaleResumeRef.current;
    if (!resume?.sale || resume.sale.estado !== 'pendiente') return null;
    const cartState = useCartStore.getState();
    if (cartState.items.length === 0) return null;

    const productos = buildPendingSaleLineItemsFromCart(
      cartState.items,
      cartState.precioClienteListaId
    );
    const subtotal = cartState.getSubtotal();
    const descuento = cartState.getDescuento();
    const impuestos = cartState.getImpuestos();
    const total = cartState.getTotal();
    const clienteId = cartState.client?.id ?? 'mostrador';
    const clienteEmbed =
      cartState.client &&
      !cartState.client.isMostrador &&
      cartState.client.id !== 'mostrador'
        ? cartState.client
        : undefined;

    await updatePendingOpenSale(
      resume.sale.id,
      {
        productos,
        subtotal,
        descuento,
        impuestos,
        total,
        clienteId,
        cliente: clienteEmbed,
        posResumeGlobalDiscount: cartState.discount,
        posResumeListaPrecios: cartState.precioClienteListaId,
      },
      { sucursalId: effectiveSucursalId ?? undefined }
    );

    const nextSale: Sale = {
      ...resume.sale,
      productos,
      subtotal,
      descuento,
      impuestos,
      total,
      clienteId,
      cliente: clienteEmbed,
      posResumeGlobalDiscount: cartState.discount,
      posResumeListaPrecios: cartState.precioClienteListaId,
      updatedAt: new Date(),
    };
    setOpenSaleResume({ sale: nextSale });
    return nextSale;
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (!openSaleResume?.sale || openSaleResume.sale.estado !== 'pendiente') return;
    const t = window.setTimeout(() => {
      void persistOpenSaleEdits().catch((err: unknown) => {
        addToast({
          type: 'error',
          message:
            err instanceof Error ? err.message : 'No se pudieron guardar los cambios de la venta abierta',
        });
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [
    items,
    discount,
    precioClienteListaId,
    client,
    openSaleResume?.sale?.id,
    openSaleResume?.sale?.estado,
    persistOpenSaleEdits,
    addToast,
  ]);

  const formasPagoPosEffective = useMemo(() => {
    let base =
      openSaleResume ?
        formasPagoPos.filter(
          (fp) =>
            fp.clave !== 'DEV' && fp.clave !== 'TTS' && fp.clave !== 'COT' && fp.clave !== 'PPC'
        )
      : [...formasPagoPos];

    const creditoDisp =
      client && !client.isMostrador && client.id !== 'mostrador' ?
        saldoCreditoCliente(client)
      : 0;
    if (creditoDisp > 0.005 && !base.some((fp) => fp.clave === 'STC')) {
      base = [
        ...base,
        {
          clave: 'STC' as const,
          descripcion: `Crédito de tienda (${formatMoney(creditoDisp)})`,
        },
      ];
    }
    return base;
  }, [formasPagoPos, openSaleResume, client]);

  const formaPagoSelectValue = useMemo(() => {
    if (formasPagoPosEffective.some((fp) => fp.clave === formaPago)) return formaPago;
    return formasPagoPosEffective[0]?.clave ?? '01';
  }, [formasPagoPosEffective, formaPago]);

  const metodoPagoSelectValue: 'PUE' | 'PPD' = metodoPago === 'PPD' ? 'PPD' : 'PUE';

  const precioClienteListaSelectValue = useMemo((): ClientPriceListId => {
    if (priceListCatalog.ids.includes(precioClienteListaId)) return precioClienteListaId;
    return 'regular';
  }, [precioClienteListaId, priceListCatalog.ids]);

  const [devolucionFolioInput, setDevolucionFolioInput] = useState('');
  const [devolucionSaleResuelta, setDevolucionSaleResuelta] = useState<Sale | null>(null);
  const [devolucionBusy, setDevolucionBusy] = useState(false);
  /** Cantidades a devolver por id de línea (0 = no devolver). Por defecto: todo el ticket. */
  const [devolucionLineasQty, setDevolucionLineasQty] = useState<Record<string, number>>({});
  /** Si true, el importe de la devolución se acredita como crédito de tienda (sin efectivo). */
  const [devolucionAcreditarCuenta, setDevolucionAcreditarCuenta] = useState(false);
  const [cotizacionUltimos4, setCotizacionUltimos4] = useState('');
  const [cotizacionBusy, setCotizacionBusy] = useState(false);
  const [saleFromQuotationId, setSaleFromQuotationId] = useState<string | null>(null);
  const [quotationLoadedFolio, setQuotationLoadedFolio] = useState<string | null>(null);

  const esFormaDevolucion = formaPago === 'DEV';
  const esFormaCotizacion = formaPago === 'COT';
  const esFormaPendientePago = formaPago === 'PPC';

  /** Valor anterior de forma de pago: al salir de PPC se restablece PUE para no dejar PPD heredado (saldo en CxC sin querer). */
  const formaPagoPrevRef = useRef(formaPago);
  useEffect(() => {
    const prev = formaPagoPrevRef.current;
    formaPagoPrevRef.current = formaPago;

    if (formaPago === 'PPC') {
      setMetodoPago('PPD');
      useCartStore.setState({ pagos: [] });
    } else if (prev === 'PPC') {
      setMetodoPago('PUE');
    }
  }, [formaPago, setMetodoPago]);

  useEffect(() => {
    if (!formasPagoPosEffective.some((fp) => fp.clave === formaPago)) {
      setFormaPago('01');
    }
  }, [formasPagoPosEffective, formaPago, setFormaPago]);

  useEffect(() => {
    if (!esFormaDevolucion) {
      setDevolucionFolioInput('');
      setDevolucionSaleResuelta(null);
      setDevolucionLineasQty({});
    } else {
      setOpenSaleResume(null);
      setSaleFromQuotationId(null);
      setQuotationLoadedFolio(null);
      setCotizacionUltimos4('');
    }
  }, [esFormaDevolucion]);

  useEffect(() => {
    if (!devolucionSaleResuelta?.productos?.length) {
      setDevolucionLineasQty({});
      setDevolucionAcreditarCuenta(false);
      return;
    }
    const init: Record<string, number> = {};
    for (const p of devolucionSaleResuelta.productos) {
      init[p.id] = Number(p.cantidad) || 0;
    }
    setDevolucionLineasQty(init);
    setDevolucionAcreditarCuenta(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al resolver otro ticket (id)
  }, [devolucionSaleResuelta?.id]);

  const previewDevolucion = useMemo(
    () => previewReembolsoDevolucion(devolucionSaleResuelta, devolucionLineasQty),
    [devolucionSaleResuelta, devolucionLineasQty]
  );

  const devolucionClienteIdAcreditable = useMemo(() => {
    const id = (devolucionSaleResuelta?.clienteId ?? '').trim();
    if (!id || id === 'mostrador') return null;
    return id;
  }, [devolucionSaleResuelta?.clienteId]);

  const puedeAcreditarDevolucion =
    Boolean(devolucionClienteIdAcreditable) && (previewDevolucion?.reembolso ?? 0) > 0.005;

  useEffect(() => {
    if (!puedeAcreditarDevolucion) setDevolucionAcreditarCuenta(false);
  }, [puedeAcreditarDevolucion]);

  useEffect(() => {
    if (esFormaCotizacion) {
      setOpenSaleResume(null);
      setDevolucionFolioInput('');
      setDevolucionSaleResuelta(null);
      setDevolucionLineasQty({});
      useCartStore.setState({ pagos: [] });
    }
  }, [esFormaCotizacion]);

  /** Sin useMemo: se recalcula cada vez que useShallow detecta cambio en items/pagos/discount (evita Cobrar $0.00). */
  const subtotalVenta = cart.getSubtotal();
  const descuentoVenta = cart.getDescuento();
  const impuestosVenta = cart.getImpuestos();
  const totalVenta = cart.getTotal();
  const totalPagadoVenta = cart.getTotalPagado();
  const cambioVenta = cart.getCambio();

  const esTraspasoTienda =
    isAdmin && formaPago === 'TTS' && Boolean(transferenciaDestinoSucursalId?.trim());

  const totalCobro = esTraspasoTienda ? 0 : totalVenta;
  const subtotalCobro = esTraspasoTienda ? 0 : subtotalVenta;
  const impuestosCobro = esTraspasoTienda ? 0 : impuestosVenta;
  const descuentoCobro = esTraspasoTienda ? 0 : descuentoVenta;

  /** Importe a cubrir en cobro: saldo del ticket si se retomó una venta `completada` con adeudo (CxC). */
  const cobroReferencia = useMemo(() => {
    if (esTraspasoTienda) return 0;
    const s = openSaleResume?.sale;
    if (s?.estado === 'completada') {
      const a = computeSaleClienteAdeudo(s);
      if (a > 0.005) return a;
    }
    return totalCobro;
  }, [esTraspasoTienda, openSaleResume, totalCobro]);

  /** PPD + cliente registrado: permite cobrar menos del total (saldo en cuenta del cliente). */
  const puedeVentaConSaldoPendiente =
    !esTraspasoTienda &&
    metodoPago === 'PPD' &&
    Boolean(client?.id && client.id !== 'mostrador' && !client.isMostrador);

  const labelFormaPago = (clave: string) => {
    if (clave === 'STC') return 'Crédito de tienda';
    return formasPagoPos.find((fp) => fp.clave === clave)?.descripcion ?? clave;
  };

  const [searchQuery, setSearchQuery] = useState('');
  /** Texto ya buscado (tras debounce); evita mostrar «sin resultados» mientras el usuario sigue escribiendo. */
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [posSearchHighlightIdx, setPosSearchHighlightIdx] = useState(-1);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>('payment');
  const checkoutPhaseRef = useRef<CheckoutPhase>('payment');
  checkoutPhaseRef.current = checkoutPhase;
  const [ticketSnapshot, setTicketSnapshot] = useState<PosTicketSnapshot | null>(null);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [ventaClienteSearch, setVentaClienteSearch] = useState('');

  useEffect(() => {
    if (showClientDialog) setVentaClienteSearch('');
  }, [showClientDialog]);

  const [montoRecibidoInput, setMontoRecibidoInput] = useState('');
  const [checkoutClienteNombre, setCheckoutClienteNombre] = useState('');
  /** En parcialidades (PPD), medio del próximo abono (mezcla efectivo + tarjetas sin cambiar el selector lateral). */
  const [ppdAbonoFormaPago, setPpdAbonoFormaPago] = useState('01');
  /** Se incrementa al abrir el diálogo de cobro para inicializar `ppdAbonoFormaPago` sin pisar cambios al mover el selector lateral. */
  const [checkoutPaymentKey, setCheckoutPaymentKey] = useState(0);
  const [processingSale, setProcessingSale] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('cart');
  const isMobile = useIsMobile();
  const [globalDiscFocus, setGlobalDiscFocus] = useState(false);
  /** Fila del carrito cuyo % descuento está enfocado (vacío visual si es 0, como desc. global). */
  const [lineDiscountFocusProductId, setLineDiscountFocusProductId] = useState<string | null>(null);
  /** Cantidad mética en edición hasta blur (metro/cm como texto decimal). */
  const [qtyLineEdit, setQtyLineEdit] = useState<{ productId: string; text: string } | null>(
    null
  );
  /** Producto cuyo popup de descripción está abierto (carrito). */
  const [productDescriptionDialog, setProductDescriptionDialog] = useState<Product | null>(null);
  const [ubicacionDialogProduct, setUbicacionDialogProduct] = useState<Product | null>(null);
  const [productDescriptionEditText, setProductDescriptionEditText] = useState('');
  const [productDescriptionSaving, setProductDescriptionSaving] = useState(false);
  const [ventaResetConfirmOpen, setVentaResetConfirmOpen] = useState(false);
  const [ventaResetBusy, setVentaResetBusy] = useState(false);
  const [unitPriceDialogOpen, setUnitPriceDialogOpen] = useState(false);
  const [unitPriceEditProductId, setUnitPriceEditProductId] = useState<string | null>(null);
  const [unitPriceEditStep, setUnitPriceEditStep] = useState<'pin' | 'price'>('pin');
  const [unitPricePinInput, setUnitPricePinInput] = useState('');
  const [unitPriceInput, setUnitPriceInput] = useState('');
  const [listasPrecioCatalogDialogOpen, setListasPrecioCatalogDialogOpen] = useState(false);
  const [listasPrecioStr, setListasPrecioStr] = useState<Record<ClientPriceListId, string>>(() =>
    emptyListaPrecioStrMap()
  );
  /** Base en la que el usuario ve/edita los importes del modal (convierte al guardar si difiere del catálogo). */
  const [listasPrecioCatalogEditConIva, setListasPrecioCatalogEditConIva] = useState(true);
  const [listasPrecioCatalogSaving, setListasPrecioCatalogSaving] = useState(false);
  const [mobileScannerOpen, setMobileScannerOpen] = useState(false);
  const [mobileScannerBusy, setMobileScannerBusy] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const unitPricePinInputRef = useRef<HTMLInputElement>(null);
  const unitPriceManualInputRef = useRef<HTMLInputElement>(null);
  /** En navegador el handle es `number`; evitar choque con tipos de Node (`Timeout`). */
  const posScanIdleTimerRef = useRef<number | null>(null);
  /** Cola de códigos (pistola rápida): no se pierde un Enter mientras el anterior aún resuelve). */
  const posScanQueueRef = useRef<string[]>([]);
  const posScanProcessingRef = useRef(false);
  /** Timestamps de la secuencia actual en el buscador (para distinguir pistola vs tipeo manual). */
  const posSearchPrevKeyTsRef = useRef(0);
  const posSearchFirstKeyTsRef = useRef(0);
  const posSearchHadSlowKeyGapRef = useRef(false);
  const productSearchWrapRef = useRef<HTMLDivElement>(null);
  const posSearchListRef = useRef<HTMLDivElement>(null);
  const mobileScannerRef = useRef<Html5Qrcode | null>(null);
  const mobileScannerScanHandledRef = useRef(false);
  const mobileScannerCooldownUntilRef = useRef(0);
  const mobileScannerElementIdRef = useRef('pos-mobile-scanner');

  const {
    results: searchResults,
    loading: productSearchLoading,
    search: searchProducts,
    searchByBarcode,
  } = useProductSearch({ maxResults: 80 });
  const { clients, refresh: refreshClients, emitirCreditoTienda } = useClients();

  const clientesFiltradosParaCxc = useMemo(
    () => filterClientesRegistrados(clients, pasarCxcClienteSearch),
    [clients, pasarCxcClienteSearch]
  );

  const clientesFiltradosVenta = useMemo(
    () => filterClientesRegistrados(clients, ventaClienteSearch),
    [clients, ventaClienteSearch]
  );

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDebouncedSearchQuery('');
      void searchProducts('');
      return;
    }
    const qSearch = posSearchEffectiveQuery(q);
    const t = window.setTimeout(() => {
      setDebouncedSearchQuery(qSearch);
      void searchProducts(qSearch);
    }, 100);
    return () => window.clearTimeout(t);
  }, [searchQuery, searchProducts]);

  useEffect(() => {
    if (searchResults.length === 1) setPosSearchHighlightIdx(0);
    else setPosSearchHighlightIdx(-1);
  }, [searchResults]);

  useEffect(() => {
    if (posSearchHighlightIdx < 0 || !posSearchListRef.current) return;
    const el = posSearchListRef.current.querySelector(
      `[data-pos-search-idx="${posSearchHighlightIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [posSearchHighlightIdx, searchResults]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Al entrar al POS, foco en búsqueda para escanear sin clic (F2 sigue disponible). */
  useEffect(() => {
    if (!hasPermission('ventas:crear')) return;
    const path = location.pathname.replace(/\/$/, '');
    if (!path.endsWith('/pos')) return;
    let id1 = 0;
    let id2 = 0;
    id1 = window.requestAnimationFrame(() => {
      id2 = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus({ preventScroll: true });
        setShowProductSearch(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(id1);
      window.cancelAnimationFrame(id2);
    };
  }, [location.pathname, hasPermission]);

  useEffect(() => {
    return () => {
      if (posScanIdleTimerRef.current != null) {
        window.clearTimeout(posScanIdleTimerRef.current);
        posScanIdleTimerRef.current = null;
      }
    };
  }, []);

  /**
   * Cierra el desplegable al clic fuera del buscador. El blur/cierre NO debe ejecutarse en la fase capture
   * del mismo evento: si no, el input pierde el foco antes de que el botón externo (p. ej. quitar del carrito)
   * reciba el `click` y el navegador cancela la acción.
   */
  useEffect(() => {
    const dropdownOpen = showProductSearch && searchQuery.trim().length > 0;
    if (!dropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = productSearchWrapRef.current;
      if (!root?.contains(e.target as Node)) {
        window.setTimeout(() => {
          setShowProductSearch(false);
          searchInputRef.current?.blur();
        }, 0);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showProductSearch, searchQuery]);

  /** Vacía carrito local y borrador en nube/localStorage (evita que el ítem “reviva” tras cobrar). */
  const finalizePosCartAfterSale = useCallback(async () => {
    clearCart();
    const uid = user?.id?.trim();
    const sid = effectiveSucursalId?.trim();
    if (!uid || !sid) return;
    try {
      await commitEmptyPosCartDraft(sid, uid);
    } catch (err) {
      console.error('commitEmptyPosCartDraft:', err);
    }
  }, [clearCart, user?.id, effectiveSucursalId]);

  const handleCheckoutOpenChange = useCallback((open: boolean) => {
    setCheckoutOpen(open);
    if (!open) {
      if (checkoutPhaseRef.current === 'success') {
        void finalizePosCartAfterSale();
      }
      setCheckoutPhase('payment');
      setTicketSnapshot(null);
      setCheckoutClienteNombre('');
      setMobileTab('cart');
    }
  }, [finalizePosCartAfterSale]);

  /** Reinicia carrito, cobro, búsqueda y devolución como al entrar al POS. */
  const resetPuntoVenta = useCallback(() => {
    handleCheckoutOpenChange(false);
    setOpenSaleResume(null);
    setSaleFromQuotationId(null);
    setQuotationLoadedFolio(null);
    setCotizacionUltimos4('');
    void finalizePosCartAfterSale();
    setSearchQuery('');
    posSearchPrevKeyTsRef.current = 0;
    posSearchFirstKeyTsRef.current = 0;
    posSearchHadSlowKeyGapRef.current = false;
    setDebouncedSearchQuery('');
    setPosSearchHighlightIdx(-1);
    setShowProductSearch(false);
    setShowClientDialog(false);
    setMontoRecibidoInput('');
    setCheckoutClienteNombre('');
    setProcessingSale(false);
    setGlobalDiscFocus(false);
    setLineDiscountFocusProductId(null);
    setProductDescriptionDialog(null);
    setDevolucionFolioInput('');
    setDevolucionSaleResuelta(null);
    setDevolucionLineasQty({});
    setDevolucionBusy(false);
    setVentaResetConfirmOpen(false);
    searchInputRef.current?.blur();
  }, [finalizePosCartAfterSale, handleCheckoutOpenChange]);

  const confirmVentaReset = useCallback(async () => {
    const resumed = openSaleResume;
    if (resumed?.sale.estado === 'pendiente') {
      setVentaResetBusy(true);
      try {
        await ejecutarCancelacionVenta(resumed.sale.id, {
          motivo: 'Venta abierta anulada desde el punto de venta',
        });
        try {
          await unlinkQuotationFromCancelledSale(resumed.sale.id, effectiveSucursalId ?? undefined);
        } catch (e) {
          console.error(e);
        }
        addToast({
          type: 'success',
          message: `Venta ${resumed.sale.folio} cancelada; el inventario se reintegró y ya no aparece en pendientes.`,
        });
        resetPuntoVenta();
      } catch (e: unknown) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo cancelar la venta abierta',
        });
      } finally {
        setVentaResetBusy(false);
      }
      return;
    }
    resetPuntoVenta();
  }, [openSaleResume, ejecutarCancelacionVenta, addToast, resetPuntoVenta, effectiveSucursalId]);

  const openUnitPriceDialog = (productId: string) => {
    const it = items.find((i) => i.product.id === productId);
    if (!it) return;
    setUnitPriceEditProductId(productId);
    setUnitPriceEditStep(isAdmin ? 'price' : 'pin');
    setUnitPricePinInput('');
    const baseSinIva = getProductUnitSinIvaForClienteList(it.product, 'regular');
    const conIva = unitBaseSinIvaToPrecioConIva(baseSinIva, it.product.impuesto);
    setUnitPriceInput(conIva.toFixed(2));
    setUnitPriceDialogOpen(true);
  };

  const closeUnitPriceDialog = useCallback(() => {
    setListasPrecioCatalogDialogOpen(false);
    setUnitPriceDialogOpen(false);
    setUnitPriceEditProductId(null);
    setUnitPriceEditStep('pin');
    setUnitPricePinInput('');
    setUnitPriceInput('');
  }, []);

  useEffect(() => {
    if (!unitPriceDialogOpen) return;
    const t = window.setTimeout(() => {
      if (unitPriceEditStep === 'pin') {
        unitPricePinInputRef.current?.focus();
      } else {
        const el = unitPriceManualInputRef.current;
        el?.focus();
        el?.select();
      }
    }, 0);
    return () => clearTimeout(t);
  }, [unitPriceDialogOpen, unitPriceEditStep]);

  const canEditCatalogListasDesdePos = hasPermission('inventario:editar');

  const openListasPrecioCatalogDialog = () => {
    const pid = unitPriceEditProductId;
    const it = pid ? items.find((i) => i.product.id === pid) : undefined;
    if (!it) return;
    const p = it.product;
    const incluye = effectiveListaPreciosIncluyenIva(p);
    const next = emptyListaPrecioStrMap();
    for (const id of priceListCatalog.ids) {
      const v = incluye
        ? getProductUnitConIvaForClienteList(p, id)
        : getProductUnitSinIvaForClienteList(p, id);
      next[id] = v > 0 ? v.toFixed(2) : '';
    }
    setListasPrecioStr(next);
    setListasPrecioCatalogEditConIva(incluye);
    setListasPrecioCatalogDialogOpen(true);
  };

  const toggleListasPrecioCatalogEditConIva = () => {
    const pid = unitPriceEditProductId;
    const it = pid ? items.find((i) => i.product.id === pid) : undefined;
    if (!it || listasPrecioCatalogSaving) return;
    const imp = Number(it.product.impuesto) || 16;
    setListasPrecioCatalogEditConIva((prev) => {
      setListasPrecioStr((strs) => {
        const out = { ...strs };
        for (const id of priceListCatalog.ids) {
          const raw = (strs[id] ?? '').trim();
          if (raw === '') continue;
          const n = parsePrecioNumberFromFirestore(raw);
          if (!Number.isFinite(n) || n < 0) continue;
          const converted = prev
            ? precioConIvaToUnitBaseSinIva(n, imp)
            : unitBaseSinIvaToPrecioConIva(n, imp);
          out[id] = roundMoney2(converted).toFixed(2);
        }
        return out;
      });
      return !prev;
    });
  };

  const saveListasPrecioCatalogFromPos = async () => {
    const pid = unitPriceEditProductId;
    const it = pid ? items.find((i) => i.product.id === pid) : undefined;
    if (!pid || !it) return;
    const p = it.product;
    setListasPrecioCatalogSaving(true);
    try {
      const imp = Number(p.impuesto) || 16;
      const almacenListaConIva = effectiveListaPreciosIncluyenIva(p);
      const mergedMap: Partial<Record<ClientPriceListId, number>> = { ...(p.preciosPorListaCliente ?? {}) };
      for (const id of priceListCatalog.ids) {
        const raw = (listasPrecioStr[id] ?? '').trim();
        if (raw === '') {
          delete mergedMap[id];
          continue;
        }
        const n = parsePrecioNumberFromFirestore(raw);
        if (!Number.isFinite(n) || n < 0) {
          addToast({
            type: 'warning',
            message: `Precio inválido en «${priceListCatalog.labels[id] ?? id}»`,
          });
          return;
        }
        mergedMap[id] = listaPrecioDialogInputToStoredValue(
          n,
          listasPrecioCatalogEditConIva,
          almacenListaConIva,
          imp
        );
      }
      const cleaned =
        Object.keys(mergedMap).length > 0
          ? (mergedMap as NonNullable<Product['preciosPorListaCliente']>)
          : undefined;
      const listasParaPersist = cleaned ?? ({} as NonNullable<Product['preciosPorListaCliente']>);
      const newPv = resolvePrecioVentaSinIvaForDoc({
        rawPv: p.precioVenta,
        preciosPorListaCliente: cleaned,
        preciosListaIncluyenIva: p.preciosListaIncluyenIva,
        impuesto: imp,
      });
      const nextProduct: Product = {
        ...p,
        preciosPorListaCliente: cleaned,
        precioVenta: newPv,
        updatedAt: new Date(),
      };
      const sid = effectiveSucursalId?.trim();
      if (sid) {
        await updateProductFirestore(sid, p.id, {
          preciosPorListaCliente: listasParaPersist,
          precioVenta: newPv,
        });
      } else {
        await updateProduct(p.id, {
          preciosPorListaCliente: listasParaPersist,
          precioVenta: newPv,
        });
      }
      useCartStore.getState().reconcileCartProductsFromCatalog([nextProduct]);
      addToast({
        type: 'success',
        message: 'Precios por lista guardados en el catálogo',
      });
      setListasPrecioCatalogDialogOpen(false);
      closeUnitPriceDialog();
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudieron guardar los precios',
      });
    } finally {
      setListasPrecioCatalogSaving(false);
    }
  };

  useEffect(() => {
    if (productDescriptionDialog) {
      setProductDescriptionEditText(
        typeof productDescriptionDialog.descripcion === 'string' ? productDescriptionDialog.descripcion : ''
      );
    } else {
      setProductDescriptionEditText('');
    }
  }, [productDescriptionDialog]);

  const saveProductDescriptionFromPos = async () => {
    if (!canEditCatalogListasDesdePos) {
      addToast({
        type: 'warning',
        message: 'No tiene permiso para guardar en el catálogo. Se requiere el permiso inventario:editar.',
      });
      return;
    }
    const p = productDescriptionDialog;
    if (!p) return;
    setProductDescriptionSaving(true);
    try {
      const trimmed = productDescriptionEditText.trim();
      const docValue = trimmed.length > 0 ? trimmed : null;
      const sid = effectiveSucursalId?.trim();
      if (sid) {
        await updateProductFirestore(sid, p.id, { descripcion: docValue } as Partial<Product>);
      } else {
        await updateProduct(p.id, {
          descripcion: docValue ?? undefined,
        });
      }
      const nextProduct: Product = {
        ...p,
        descripcion: docValue ?? undefined,
        updatedAt: new Date(),
      };
      useCartStore.getState().reconcileCartProductsFromCatalog([nextProduct]);
      addToast({
        type: 'success',
        message: 'Descripción guardada en el catálogo.',
      });
      setProductDescriptionDialog(null);
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar la descripción.',
      });
    } finally {
      setProductDescriptionSaving(false);
    }
  };

  const confirmUnitPricePin = () => {
    if (unitPricePinInput.trim() === POS_EDIT_UNIT_PRICE_PIN) {
      setUnitPriceEditStep('price');
      setUnitPricePinInput('');
      return;
    }
    addToast({ type: 'error', message: 'Contraseña incorrecta' });
  };

  const syncUnitPriceInputFromCartLine = useCallback(() => {
    const pid = unitPriceEditProductId;
    if (!pid) return;
    const it = useCartStore.getState().items.find((i) => i.product.id === pid);
    if (!it) return;
    const baseSinIva = getCartLineUnitSinIvaBase(it, precioClienteListaId);
    const conIva = unitBaseSinIvaToPrecioConIva(baseSinIva, it.product.impuesto);
    setUnitPriceInput(conIva.toFixed(2));
  }, [unitPriceEditProductId, precioClienteListaId]);

  const saveUnitPriceFromDialog = () => {
    if (!unitPriceEditProductId) return;
    const it = items.find((i) => i.product.id === unitPriceEditProductId);
    if (!it) return;
    const v = parseFloat(unitPriceInput.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) {
      addToast({ type: 'warning', message: 'Ingrese un precio válido (con IVA incluido)' });
      return;
    }
    const sinIva = precioConIvaToUnitBaseSinIva(v, it.product.impuesto);
    updateLineUnitPrice(unitPriceEditProductId, sinIva);
    addToast({ type: 'success', message: 'Precio manual guardado en la línea'});
    closeUnitPriceDialog();
  };

  const unitPriceDialogLine = unitPriceEditProductId
    ? items.find((i) => i.product.id === unitPriceEditProductId)
    : undefined;
  const unitPriceLineIsManual =
    unitPriceDialogLine != null &&
    unitPriceDialogLine.precioUnitarioOverride != null &&
    Number.isFinite(Number(unitPriceDialogLine.precioUnitarioOverride));
  const unitPriceLineListaActiva: ClientPriceListId | null = unitPriceLineIsManual
    ? null
    : (unitPriceDialogLine?.precioListaId ?? precioClienteListaId);

  const openCheckoutDialog = () => {
    reapplyPromotions();
    const nombreInicial =
      client && !client.isMostrador && client.id !== 'mostrador'
        ? client.nombre
        : openSaleResume?.sale?.cliente?.nombre?.trim() &&
            !isPosGenericClienteNombre(openSaleResume.sale.cliente.nombre.trim())
          ? openSaleResume.sale.cliente.nombre.trim()
          : '';
    setCheckoutClienteNombre(nombreInicial);
    setCheckoutPhase('payment');
    setCheckoutOpen(true);
    setCheckoutPaymentKey((k) => k + 1);
  };

  useEffect(() => {
    if (checkoutOpen && (checkoutPhase === 'payment' || checkoutPhase === 'success')) {
      setMontoRecibidoInput('');
    }
  }, [checkoutOpen, checkoutPhase]);

  const formaPagoRef = useRef(formaPago);
  formaPagoRef.current = formaPago;

  useEffect(() => {
    if (!checkoutOpen || checkoutPhase !== 'payment' || metodoPago !== 'PPD') return;
    const fp = formaPagoRef.current;
    const ok = FORMAS_PAGO_UI.some((f) => f.clave === fp);
    setPpdAbonoFormaPago(ok ? fp : '01');
  }, [checkoutOpen, checkoutPhase, metodoPago, checkoutPaymentKey]);

  /**
   * Si el usuario dejó «Una exhibición (PUE)» pero ya registró un abono y aún falta por cobrar,
   * pasa a Parcialidades (PPD) para el mismo flujo y el selector «Medio de este abono».
   */
  useEffect(() => {
    if (!checkoutOpen || checkoutPhase !== 'payment') return;
    if (formaPago === 'PPC' || esTraspasoTienda || esFormaDevolucion || esFormaCotizacion) return;
    if (metodoPago !== 'PUE') return;
    if (pagos.length === 0) return;
    if (totalPagadoVenta + 0.004 >= cobroReferencia) return;
    setMetodoPago('PPD');
  }, [
    checkoutOpen,
    checkoutPhase,
    formaPago,
    esTraspasoTienda,
    esFormaDevolucion,
    esFormaCotizacion,
    metodoPago,
    pagos,
    totalPagadoVenta,
    cobroReferencia,
    setMetodoPago,
  ]);

  const ppdAbonoFormasEffective = useMemo(() => {
    const base = [...FORMAS_PAGO_UI];
    const creditoDisp =
      client && !client.isMostrador && client.id !== 'mostrador' ?
        saldoCreditoCliente(client)
      : 0;
    if (creditoDisp > 0.005 && !base.some((fp) => fp.clave === 'STC')) {
      base.push({
        clave: 'STC',
        descripcion: `Crédito de tienda (${formatMoney(creditoDisp)})`,
      });
    }
    return base;
  }, [client]);

  const ppdAbonoFormaSelectValue = useMemo(() => {
    if (ppdAbonoFormasEffective.some((f) => f.clave === ppdAbonoFormaPago)) return ppdAbonoFormaPago;
    return '01';
  }, [ppdAbonoFormaPago, ppdAbonoFormasEffective]);

  const creditoTiendaDisponibleCheckout = useMemo(() => {
    if (!client || client.isMostrador || client.id === 'mostrador') return 0;
    return saldoCreditoCliente(client);
  }, [client]);

  const creditoTiendaYaEnPagos = useMemo(
    () =>
      sumCreditoTiendaEnPagosParcial(
        pagos as { formaPago: FormaPago; monto: number }[]
      ),
    [pagos]
  );

  const creditoTiendaRestanteCheckout = Math.max(
    0,
    Math.round((creditoTiendaDisponibleCheckout - creditoTiendaYaEnPagos) * 100) / 100
  );

  /** Capar monto STC al crédito restante y al faltante del ticket. */
  const montoStcCapped = useCallback(
    (montoRaw: number): number => {
      const falta = Math.max(0, cobroReferencia - totalPagadoVenta);
      const cap = Math.min(montoRaw, creditoTiendaRestanteCheckout, falta);
      return Math.round(Math.max(0, cap) * 100) / 100;
    },
    [cobroReferencia, totalPagadoVenta, creditoTiendaRestanteCheckout]
  );

  const esFormaTarjeta = (fp: string) => fp === '04' || fp === '28';
  const esFormaEfectivo = (fp: string) => fp === '01';

  /** Forma aplicada al siguiente abono manual (en PPD la elige el diálogo). */
  const formaPagoAbono = metodoPago === 'PPD' ? ppdAbonoFormaPago : formaPago;

  /** Tarjeta en una sola exhibición (PUE): cobro total sin campo de monto ni billetes rápidos. */
  const cobroTarjetaPue =
    !esTraspasoTienda && esFormaTarjeta(formaPago) && metodoPago === 'PUE';

  /**
   * Total que quedará cubierto al pulsar «Completar venta» (incluye lo que aún está solo en el campo,
   * igual que `handleProcessSale`), para habilitar el botón sin usar «Agregar».
   */
  const totalPagadoIncluyeCampoMonto = useMemo(() => {
    if (formaPago === 'PPC' || esTraspasoTienda) return totalPagadoVenta;
    if (cobroTarjetaPue) return totalPagadoVenta;

    const norm = montoRecibidoInput.replace(',', '.').trim();
    if (!norm) return totalPagadoVenta;
    const extra = parseFloat(norm);
    if (!Number.isFinite(extra) || extra <= 0) return totalPagadoVenta;

    if (metodoPago === 'PPD') {
      return totalPagadoVenta + extra;
    }
    if (metodoPago === 'PUE' && !esFormaDevolucion && !esFormaCotizacion) {
      return totalPagadoVenta + extra;
    }
    return totalPagadoVenta;
  }, [
    totalPagadoVenta,
    montoRecibidoInput,
    formaPago,
    metodoPago,
    esTraspasoTienda,
    cobroTarjetaPue,
    esFormaDevolucion,
    esFormaCotizacion,
  ]);

  useEffect(() => {
    if (!checkoutOpen || checkoutPhase !== 'payment' || !esTraspasoTienda) return;
    if (pagos.length === 0) {
      addPago({ formaPago: 'TTS', monto: 0 });
    }
  }, [checkoutOpen, checkoutPhase, esTraspasoTienda, pagos.length, addPago]);

  const commitMontoRecibido = () => {
    const normalized = montoRecibidoInput.replace(',', '.').trim();
    let monto = parseFloat(normalized) || 0;
    if (monto <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto mayor a cero' });
      return;
    }
    if (formaPagoAbono === 'STC') {
      const capped = montoStcCapped(monto);
      if (capped <= 0.005) {
        addToast({
          type: 'warning',
          message:
            creditoTiendaRestanteCheckout <= 0.005
              ? 'No hay crédito de tienda disponible'
              : 'El ticket ya está cubierto',
        });
        return;
      }
      if (capped + 0.001 < monto) {
        addToast({
          type: 'info',
          message: `Se aplicaron ${formatMoney(capped)} de crédito (máximo disponible / faltante).`,
        });
      }
      monto = capped;
    }
    addPago({ formaPago: formaPagoAbono, monto });
    setMontoRecibidoInput('');
  };

  const aplicarCreditoTiendaDisponible = () => {
    const capped = montoStcCapped(creditoTiendaRestanteCheckout);
    if (capped <= 0.005) {
      addToast({
        type: 'warning',
        message:
          creditoTiendaRestanteCheckout <= 0.005
            ? 'No hay crédito de tienda disponible'
            : 'El ticket ya está cubierto',
      });
      return;
    }
    addPago({ formaPago: 'STC', monto: capped });
    setMontoRecibidoInput('');
    if (metodoPago !== 'PPD' && capped + 0.004 < cobroReferencia - totalPagadoVenta + capped) {
      setMetodoPago('PPD');
    }
    const falta = Math.max(0, cobroReferencia - (totalPagadoVenta + capped));
    if (falta > 0.005) {
      addToast({
        type: 'success',
        message: `Crédito aplicado: ${formatMoney(capped)}. Falta ${formatMoney(falta)}`,
      });
    }
  };

  const handleAddProduct = useCallback((product: Product, quantityArg?: number) => {
    try {
      const parsed = parsePosQuantityPrefix(searchQuery.trim());
      const rawQty = quantityArg ?? parsed.quantity;
      const qty = snapCantidadLineaVenta(product.unidadMedida, rawQty);
      addItem(product, qty);
      setSearchQuery('');
      posSearchPrevKeyTsRef.current = 0;
      posSearchFirstKeyTsRef.current = 0;
      posSearchHadSlowKeyGapRef.current = false;
      setShowProductSearch(false);
      const u = normalizeClaveUnidadSat(product.unidadMedida);
      const esMetrico = u === 'MTR' || u === 'CMT';
      const qtySuffix =
        qty > 1 || esMetrico
          ? ` · ${formatearCantidadLineaVentaSat(product.unidadMedida, qty)} ${abrevCantidadVentaPorUnidadSat(product.unidadMedida)}`
          : '';
      addToast({
        type: 'success',
        message: `${product.nombre} agregado${qtySuffix}`,
      });
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Error al agregar',
      });
    }
  }, [addItem, addToast, searchQuery]);

  /** Escáner USB: Enter o silencio breve; cola para lecturas seguidas (incluye las que llegan durante un `await`). */
  const processPosScanQueue = useCallback(async () => {
    if (posScanProcessingRef.current) return;
    posScanProcessingRef.current = true;
    try {
      while (posScanQueueRef.current.length > 0) {
        const qTrim = posScanQueueRef.current.shift()!.trim();
        if (!qTrim) continue;
        const { quantity, rest, hadQtyPrefix } = parsePosQuantityPrefix(qTrim);
        if (hadQtyPrefix && !rest) {
          addToast({
            type: 'warning',
            message:
              'Escriba el código después de la cantidad (ej. 10* o 2,5* y luego el código de barras).',
          });
          continue;
        }
        const qLookup = rest;
        const byBarcode = await searchByBarcode(qLookup);
        if (byBarcode) {
          handleAddProduct(byBarcode, quantity);
          continue;
        }
        const matches = await searchProducts(qLookup);
        if (matches.length === 1) {
          handleAddProduct(matches[0], quantity);
          continue;
        }
        if (matches.length === 0) {
          addToast({ type: 'warning', message: `Sin coincidencias para: ${qLookup}` });
          setShowProductSearch(true);
          posScanQueueRef.current = [];
          break;
        }
        setShowProductSearch(true);
        posScanQueueRef.current = [];
        break;
      }
    } finally {
      posScanProcessingRef.current = false;
      if (posScanQueueRef.current.length > 0) {
        void processPosScanQueue();
      }
    }
  }, [searchByBarcode, handleAddProduct, searchProducts, addToast]);

  const commitSearchEnter = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      posScanQueueRef.current.push(q);
      void processPosScanQueue();
    },
    [processPosScanQueue]
  );

  const flushPosScanFromInput = useCallback(() => {
    const raw = searchInputRef.current?.value.trim() ?? '';
    if (!raw || !looksLikePosScanToken(raw)) return;
    void commitSearchEnter(raw);
  }, [commitSearchEnter]);

  const onPosSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchQuery(val);
      const trim = val.trim();
      /** Si el foco no cambió, `onFocus` no corre tras agregar con Enter y el panel queda cerrado. */
      if (trim.length > 0) setShowProductSearch(true);
      if (posScanIdleTimerRef.current != null) {
        window.clearTimeout(posScanIdleTimerRef.current);
        posScanIdleTimerRef.current = null;
      }
      if (!trim) {
        posSearchPrevKeyTsRef.current = 0;
        posSearchFirstKeyTsRef.current = 0;
        posSearchHadSlowKeyGapRef.current = false;
        return;
      }

      const now = Date.now();
      const prevTs = posSearchPrevKeyTsRef.current;
      if (prevTs === 0) {
        posSearchFirstKeyTsRef.current = now;
      } else if (now - prevTs > POS_SEARCH_SLOW_KEY_GAP_MS) {
        posSearchHadSlowKeyGapRef.current = true;
      }
      posSearchPrevKeyTsRef.current = now;

      if (!looksLikePosScanToken(trim)) return;

      posScanIdleTimerRef.current = window.setTimeout(() => {
        posScanIdleTimerRef.current = null;
        const raw = searchInputRef.current?.value.trim() ?? '';
        if (!raw || !looksLikePosScanToken(raw)) return;
        if (posSearchHadSlowKeyGapRef.current) return;
        const firstTs = posSearchFirstKeyTsRef.current;
        const lastTs = posSearchPrevKeyTsRef.current;
        if (firstTs === 0 || lastTs === 0) return;
        if (lastTs - firstTs > POS_SEARCH_MAX_SCAN_BURST_SPAN_MS) return;
        flushPosScanFromInput();
      }, POS_SCAN_IDLE_MS);
    },
    [flushPosScanFromInput]
  );

  const onPosSearchPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text').trim();
      if (!text || !looksLikePosScanToken(text)) return;
      e.preventDefault();
      if (posScanIdleTimerRef.current != null) {
        window.clearTimeout(posScanIdleTimerRef.current);
        posScanIdleTimerRef.current = null;
      }
      posSearchPrevKeyTsRef.current = 0;
      posSearchFirstKeyTsRef.current = 0;
      posSearchHadSlowKeyGapRef.current = false;
      setSearchQuery(text);
      setShowProductSearch(true);
      void commitSearchEnter(text);
    },
    [commitSearchEnter]
  );

  const onPosSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const trim = searchQuery.trim();
      const effective = posSearchEffectiveQuery(trim);
      const settled =
        effective.length > 0 && debouncedSearchQuery === effective && !productSearchLoading;
      const n = searchResults.length;
      const listNavOk = settled && n > 0;

      if (e.key === 'Escape') {
        if (showProductSearch) {
          e.preventDefault();
          setShowProductSearch(false);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        if (!showProductSearch || !trim || !listNavOk) return;
        e.preventDefault();
        setPosSearchHighlightIdx((i) => (i < 0 ? 0 : Math.min(n - 1, i + 1)));
        return;
      }

      if (e.key === 'ArrowUp') {
        if (!showProductSearch || !trim || !listNavOk) return;
        e.preventDefault();
        setPosSearchHighlightIdx((i) => (i < 0 ? n - 1 : Math.max(0, i - 1)));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (posScanIdleTimerRef.current != null) {
          window.clearTimeout(posScanIdleTimerRef.current);
          posScanIdleTimerRef.current = null;
        }
        posSearchPrevKeyTsRef.current = 0;
        posSearchFirstKeyTsRef.current = 0;
        posSearchHadSlowKeyGapRef.current = false;
        if (listNavOk && posSearchHighlightIdx >= 0 && posSearchHighlightIdx < n) {
          const qty = parsePosQuantityPrefix(trim).quantity;
          handleAddProduct(searchResults[posSearchHighlightIdx], qty);
          return;
        }
        void commitSearchEnter((e.currentTarget as HTMLInputElement).value);
      }
    },
    [
      searchQuery,
      debouncedSearchQuery,
      productSearchLoading,
      searchResults,
      showProductSearch,
      posSearchHighlightIdx,
      handleAddProduct,
      commitSearchEnter,
    ]
  );

  const stopMobileScanner = useCallback(async () => {
    const scanner = mobileScannerRef.current;
    mobileScannerScanHandledRef.current = false;
    mobileScannerCooldownUntilRef.current = 0;
    if (!scanner) return;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
    } catch (error) {
      console.warn('[POS] No se pudo detener escáner móvil:', error);
    }

    try {
      await scanner.clear();
    } catch (error) {
      console.warn('[POS] No se pudo limpiar escáner móvil:', error);
    }

    mobileScannerRef.current = null;
  }, []);

  const playScannerFeedback = useCallback((kind: 'success' | 'notFound') => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'success' ? 70 : [40, 55, 40]);
    }

    const AudioCtx =
      typeof window !== 'undefined' ? (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'success' ? 1040 : 520;
      gain.gain.value = 0.03;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      if (kind === 'success') {
        osc.stop(ctx.currentTime + 0.08);
      } else {
        osc.stop(ctx.currentTime + 0.12);
      }
      setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, 140);
    } catch {
      // Si falla audio en el navegador/dispositivo, la vibración ya cubre feedback.
    }
  }, []);

  useEffect(() => {
    if (!mobileScannerOpen) {
      void stopMobileScanner();
      return;
    }

    let cancelled = false;
    let cancelAutofocus: (() => void) | null = null;
    setMobileScannerBusy(true);
    mobileScannerScanHandledRef.current = false;

    const startScanner = async () => {
      try {
        const onScanSuccess = async (decodedText: string) => {
          const now = Date.now();
          if (now < mobileScannerCooldownUntilRef.current) return;
          mobileScannerCooldownUntilRef.current = now + 300;
          if (mobileScannerScanHandledRef.current) return;
          mobileScannerScanHandledRef.current = true;

          const codigoLeido = decodedText.trim();
          if (!codigoLeido) {
            mobileScannerScanHandledRef.current = false;
            return;
          }

          /** Busca por código de barras (normalizado); si no hay match, por SKU igual al leído. */
          const product = await searchByBarcode(codigoLeido);
          if (product) {
            playScannerFeedback('success');
            handleAddProduct(product);
          } else {
            playScannerFeedback('notFound');
            addToast({
              type: 'warning',
              message: `No hay producto con ese código de barras (ni SKU coincidente): ${codigoLeido}`,
            });
          }

          setMobileScannerOpen(false);
        };

        const onScanError = () => {
          // Ignorar errores por frame; el callback de éxito gestiona el flujo.
        };

        const scannerConfig = {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const w = Math.max(180, Math.min(320, Math.floor(viewfinderWidth * 0.9)));
            const h = Math.max(90, Math.min(180, Math.floor(viewfinderHeight * 0.45)));
            return { width: w, height: h };
          },
          // Ayuda en móviles con stream 16:9 (especialmente Android/iOS)
          aspectRatio: 16 / 9,
        };

        let cameras: { id: string; label: string }[] = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch {
          cameras = [];
        }

        const preferredBackCameraId =
          cameras.find((c) => /back|rear|environment|trasera/i.test(c.label))?.id ??
          cameras[cameras.length - 1]?.id;
        const firstCameraId = cameras[0]?.id;

        const attempts: Array<string | { facingMode: string | { exact: string } }> = [];
        if (preferredBackCameraId) attempts.push(preferredBackCameraId);
        attempts.push({ facingMode: { exact: 'environment' } });
        attempts.push({ facingMode: 'environment' });
        if (firstCameraId && firstCameraId !== preferredBackCameraId) attempts.push(firstCameraId);
        attempts.push({ facingMode: 'user' });

        let started = false;
        let lastError: unknown = null;

        for (const cameraConfig of attempts) {
          if (cancelled) return;
          const scanner = new Html5Qrcode(mobileScannerElementIdRef.current, {
            verbose: false,
            useBarCodeDetectorIfSupported: true,
          });
          try {
            await scanner.start(cameraConfig, scannerConfig, onScanSuccess, onScanError);
            mobileScannerRef.current = scanner;
            cancelAutofocus = scheduleBarcodeScannerAutofocus(scanner);
            if (cancelled) {
              cancelAutofocus();
              cancelAutofocus = null;
            }
            started = true;
            break;
          } catch (err) {
            lastError = err;
            try {
              await scanner.clear();
            } catch {
              // Ignorar; probaremos siguiente configuración de cámara.
            }
          }
        }

        if (!started) throw lastError ?? new Error('No camera start strategy succeeded');
      } catch (error) {
        if (!cancelled) {
          const raw = error instanceof Error ? error.message : String(error);
          const normalized = raw.toLowerCase();
          const denied =
            normalized.includes('permission') ||
            normalized.includes('notallowed') ||
            normalized.includes('denied');
          const notFound =
            normalized.includes('notfound') ||
            normalized.includes('devicesnotfound') ||
            normalized.includes('no camera') ||
            normalized.includes('camera not found');
          const insecureContext =
            normalized.includes('secure context') ||
            normalized.includes('only secure origins are allowed') ||
            normalized.includes('insecure');
          addToast({
            type: 'error',
            message: denied
              ? 'No se pudo acceder a la cámara. Verifique permisos de cámara en el navegador.'
              : insecureContext
                ? 'La cámara requiere conexión segura (HTTPS). Abra la app en HTTPS para usar el escáner.'
                : notFound
                  ? 'No se detectó cámara disponible en este dispositivo o navegador.'
                  : 'No se pudo iniciar el escáner de cámara. Intente cerrar otras apps que usen cámara y vuelva a abrir.',
          });
          setMobileScannerOpen(false);
        }
      } finally {
        if (!cancelled) {
          setMobileScannerBusy(false);
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      cancelAutofocus?.();
      void stopMobileScanner();
    };
  }, [mobileScannerOpen, stopMobileScanner, searchByBarcode, handleAddProduct, addToast, playScannerFeedback]);

  const handleBuscarTicketDevolucion = async () => {
    const raw = devolucionFolioInput.trim();
    if (!raw) {
      addToast({ type: 'warning', message: 'Ingrese el folio del ticket (ej. V-20260322-0001)' });
      return;
    }
    setDevolucionBusy(true);
    try {
      const s = await getSaleByFolio(raw, { sucursalId: effectiveSucursalId ?? undefined });
      if (!s) {
        setDevolucionSaleResuelta(null);
        addToast({
          type: 'error',
          message: 'No se encontró una venta con ese folio en esta tienda.',
        });
        return;
      }
      if (s.estado === 'cancelada') {
        setDevolucionSaleResuelta(s);
        addToast({
          type: 'warning',
          message:
            s.cancelacionMotivo === 'devolucion' ?
              'Este ticket ya está cancelado por devolución.'
            : 'Este ticket ya está cancelado.',
        });
        return;
      }
      if (s.estado !== 'completada') {
        setDevolucionSaleResuelta(s);
        addToast({ type: 'warning', message: 'Solo se pueden devolver ventas completadas.' });
        return;
      }
      if (s.facturaId) {
        setDevolucionSaleResuelta(null);
        addToast({
          type: 'error',
          message: 'No se puede devolver una venta facturada. Gestione la devolución en facturación.',
        });
        return;
      }
      if (s.formaPago === 'TTS') {
        setDevolucionSaleResuelta(null);
        addToast({
          type: 'error',
          message: 'No se puede devolver un traspaso entre tiendas desde el POS.',
        });
        return;
      }
      setDevolucionSaleResuelta(s);
      addToast({
        type: 'success',
        message: 'Ticket localizado. Pulse Cobrar y confirme la devolución.',
      });
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'Error al buscar el ticket',
      });
    } finally {
      setDevolucionBusy(false);
    }
  };

  const resolveProductForResume = async (productId: string): Promise<Product | undefined> => {
    if (effectiveSucursalId) {
      return getProductCatalogSnapshot().find((p) => p.id === productId);
    }
    return getProductById(productId);
  };

  const handleDejarVentaAbierta = async () => {
    if (openSaleResume) {
      addToast({
        type: 'warning',
        message: 'Termine o cancele la venta abierta que está retomando antes de crear otra.',
      });
      return;
    }
    if (saleFromQuotationId) {
      addToast({
        type: 'warning',
        message: 'Hay una cotización cargada. Cobre o vacíe el carrito antes de dejar otra venta abierta.',
      });
      return;
    }
    if (items.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos al carrito' });
      return;
    }
    if (esTraspasoTienda) {
      addToast({ type: 'warning', message: 'No aplica venta abierta en traspaso entre tiendas.' });
      return;
    }
    if (cajaSesion.mustOpenCajaToSell && !cajaSesion.activa) {
      addToast({
        type: 'warning',
        message: 'Abra caja antes de dejar una venta abierta en esta tienda.',
      });
      return;
    }
    setDejarAbiertaBusy(true);
    try {
      const cajeroNombre =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
      const notasAbierta = 'Venta abierta (pendiente de pago)';
      const saleData = {
        clienteId: client?.id || 'mostrador',
        ...(client ? { cliente: client } : {}),
        productos: buildPendingSaleLineItemsFromCart(items, precioClienteListaId),
        subtotal: subtotalCobro,
        descuento: descuentoCobro,
        impuestos: impuestosCobro,
        total: totalCobro,
        formaPago: '99' as FormaPago,
        metodoPago: 'PPD' as const,
        pagos: [] as Payment[],
        estado: 'pendiente' as const,
        notas: notasAbierta,
        usuarioId: user?.id || 'system',
        usuarioNombre: cajeroNombre,
        posResumeGlobalDiscount: discount,
        posResumeListaPrecios: precioClienteListaId,
        ...(cajaSesion.activa?.id ? { cajaSesionId: cajaSesion.activa.id } : {}),
      };

      const { folio: folioVenta } = await addSale(saleData);
      void finalizePosCartAfterSale();
      addToast({
        type: 'success',
        message: `Venta ${folioVenta} guardada como abierta (fiado). Cobre cuando pague el cliente.`,
      });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'No se pudo guardar la venta abierta',
      });
    } finally {
      setDejarAbiertaBusy(false);
    }
  };

  const resumeOpenSale = async (sale: Sale) => {
    if (saleFromQuotationId) {
      addToast({
        type: 'warning',
        message: 'Hay una cotización cargada. Cancele la venta o complétela antes de retomar una venta abierta.',
      });
      return;
    }
    if (openSaleResume && openSaleResume.sale.id !== sale.id) {
      addToast({
        type: 'warning',
        message: 'Ya hay una venta abierta en el carrito. Cancele la venta actual o complétela primero.',
      });
      return;
    }
    if (items.length > 0 && !openSaleResume) {
      addToast({
        type: 'warning',
        message: 'Vacíe el carrito o use Cancelar venta antes de retomar una venta abierta.',
      });
      return;
    }
    setResumeOpenBusy(true);
    try {
      const cartItems: CartItem[] = [];
      for (const line of sale.productos ?? []) {
        const fromCatalog = await resolveProductForResume(line.productId);
        const product = productFromSaleLineForResume(line, fromCatalog);
        cartItems.push({
          product,
          quantity: line.cantidad,
          discount: line.descuento,
          precioUnitarioOverride: line.precioUnitario,
          promoId: line.promoId,
          promoLabel: line.promoLabel,
          discountManual: !line.promoId && Number(line.descuento) > 0,
        });
      }
      let clientePos = clientFromSaleForPos(sale);
      if (!clientePos && sale.clienteId && sale.clienteId !== 'mostrador') {
        const row = await getClientById(sale.clienteId);
        if (row?.nombre?.trim()) {
          clientePos = row;
        }
      }
      const listaId = parseResumeListaPreciosId(sale);
      replaceCartForOpenSaleResume({
        items: cartItems,
        client: clientePos,
        globalDiscount: Number(sale.posResumeGlobalDiscount) || 0,
        precioClienteListaId: listaId,
      });
      setOpenSaleResume({ sale });
      setFormaPago('01');
      setVentasAbiertasDialogOpen(false);
      addToast({
        type: 'success',
        message:
          sale.estado === 'completada' && computeSaleClienteAdeudo(sale) > 0.005
            ? `Ticket ${sale.folio}: cobre el saldo pendiente y pulse Cobrar.`
            : `Venta ${sale.folio} cargada. Registre el cobro y pulse Cobrar.`,
      });
      setMobileTab('cart');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cargar la venta abierta',
      });
    } finally {
      setResumeOpenBusy(false);
    }
  };

  const resumeOpenSaleRef = useRef(resumeOpenSale);
  resumeOpenSaleRef.current = resumeOpenSale;

  /** Evita doble apertura/toast si el efecto corre dos veces con el mismo state (Strict Mode o deps). */
  const posDeepLinkHandledRef = useRef<string | null>(null);

  useEffect(() => {
    const st = location.state as {
      posPreselectClienteId?: string;
      posAbrirVentaId?: string;
    } | null | undefined;
    const ventaId = st?.posAbrirVentaId?.trim();
    const cid = st?.posPreselectClienteId?.trim();
    if (!ventaId && (!cid || cid === 'mostrador')) {
      posDeepLinkHandledRef.current = null;
      return;
    }

    const navKey = ventaId
      ? `venta:${ventaId}`
      : cid && cid !== 'mostrador'
        ? `cli:${cid}`
        : null;
    if (navKey && posDeepLinkHandledRef.current === navKey) {
      return;
    }
    if (navKey) {
      posDeepLinkHandledRef.current = navKey;
    }

    navigate('.', { replace: true, state: null });

    void (async () => {
      try {
        if (ventaId) {
          const cat = salesCatalogNavRef.current;
          let sale: Sale | undefined = cat.find((s) => s.id === ventaId);
          if (!sale && effectiveSucursalId) {
            sale = (await getSaleByIdFirestore(effectiveSucursalId, ventaId)) ?? undefined;
          }
          if (!sale) {
            sale = await getSaleById(ventaId);
          }
          if (!sale) {
            addToast({ type: 'error', message: 'No se encontró la venta en este dispositivo.' });
            return;
          }
          if (sale.estado === 'pendiente') {
            await resumeOpenSaleRef.current(sale);
            return;
          }
          const adeudoVenta = computeSaleClienteAdeudo(sale);
          if (sale.estado === 'completada' && adeudoVenta > 0.005) {
            await resumeOpenSaleRef.current(sale);
            return;
          }
          if (sale.clienteId && sale.clienteId !== 'mostrador') {
            const row = await getClientById(sale.clienteId);
            if (row?.nombre?.trim()) {
              setClient(row);
              setMobileTab('cart');
              addToast({
                type: 'success',
                message: `Venta ${sale.folio?.trim() || sale.id.slice(0, 8)} · pulse Cobrar en el POS para registrar pagos sobre el saldo.`,
              });
              return;
            }
          }
          addToast({
            type: 'warning',
            message:
              adeudoVenta <= 0.005
                ? 'Este ticket no tiene saldo pendiente en cuenta por cobrar.'
                : 'No se pudo cargar la venta en el POS.',
          });
          return;
        }

        if (cid && cid !== 'mostrador') {
          const row = await getClientById(cid);
          if (row?.nombre?.trim()) {
            setClient(row);
            setMobileTab('cart');
            addToast({
              type: 'success',
              message: 'Cliente cargado desde Cuentas por cobrar. Registre el cobro en el POS.',
            });
          } else {
            addToast({ type: 'warning', message: 'No se encontró el cliente.' });
          }
        }
      } catch {
        addToast({ type: 'error', message: 'No se pudo abrir la venta o el cliente en el POS.' });
      }
    })();
  }, [location.state, navigate, effectiveSucursalId, setClient, addToast, setMobileTab]);

  const ejecutarPasarCxcConCliente = async (vs: Sale, clienteRow: Client) => {
    setPasarCxcBusyId(vs.id);
    try {
      const cajeroNombre =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
      await completePendingSale(vs.id, {
        formaPago: 'PPC',
        metodoPago: 'PPD',
        pagos: [],
        cambio: 0,
        usuarioNombreCierre: cajeroNombre,
        cajaSesionId: cajaSesion.activa?.id,
        clienteId: clienteRow.id,
        cliente: clienteRow,
      });
      setVentasAbiertasDialogOpen(false);
      setPasarCxcClientePickerSale(null);
      addToast({
        type: 'success',
        message: `Venta ${vs.folio} pasada a cuentas por cobrar (${clienteRow.nombre}).`,
      });
      navigate('/cuentas-por-cobrar');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo pasar la venta a cuentas por cobrar',
      });
    } finally {
      setPasarCxcBusyId(null);
    }
  };

  const pasarVentaACuentasPorCobrar = async (vs: Sale) => {
    if (vs.estado !== 'pendiente') return;
    const tieneClienteRegistrado =
      Boolean(vs.clienteId) && vs.clienteId !== 'mostrador' && !vs.cliente?.isMostrador;
    if (tieneClienteRegistrado) {
      let row: Client | undefined =
        vs.cliente && vs.cliente.id && !vs.cliente.isMostrador ? (vs.cliente as Client) : undefined;
      if (!row?.nombre?.trim() && vs.clienteId && vs.clienteId !== 'mostrador') {
        row = await getClientById(vs.clienteId);
      }
      if (row?.nombre?.trim()) {
        await ejecutarPasarCxcConCliente(vs, row);
        return;
      }
    }
    setVentasAbiertasDialogOpen(false);
    setPasarCxcClientePickerSale(vs);
  };

  const abandonarVentaAbiertaRetomada = () => {
    setOpenSaleResume(null);
    void finalizePosCartAfterSale();
    addToast({ type: 'info', message: 'Se descartó el carrito. La venta sigue pendiente en la lista.' });
  };

  const handleBuscarCotizacion = async () => {
    if (openSaleResume) {
      addToast({
        type: 'warning',
        message: 'Termine o cancele la venta abierta retomada antes de cargar una cotización.',
      });
      return;
    }
    const digits = cotizacionUltimos4.replace(/\D/g, '');
    if (digits.length < 1) {
      addToast({
        type: 'warning',
        message: 'Ingrese los últimos 4 dígitos del folio de cotización (ej. 0007 para C-…-0007).',
      });
      return;
    }
    setCotizacionBusy(true);
    try {
      const q = await findQuotationByLast4Folio(cotizacionUltimos4, effectiveSucursalId ?? undefined);
      if (!q) {
        addToast({
          type: 'error',
          message:
            'No hay cotización pendiente y vigente con ese número. Revise el ticket o la pantalla Cotizaciones.',
        });
        return;
      }
      const cartItems: CartItem[] = [];
      for (const line of q.productos) {
        const fromCatalog = await resolveProductForResume(line.productId);
        const product = productFromQuotationLineForResume(line, fromCatalog);
        cartItems.push({
          product,
          quantity: line.cantidad,
          discount: line.descuento,
          precioUnitarioOverride: line.precioUnitario,
          /** Mantener descuento de cotización; no pisar con promo automática. */
          discountManual: Number(line.descuento) > 0,
        });
      }
      let clientePos = clientFromQuotationForPos(q);
      if (!clientePos && q.clienteId && q.clienteId !== 'mostrador') {
        const row = await getClientById(q.clienteId);
        if (row?.nombre?.trim()) clientePos = row;
      }
      replaceCartForOpenSaleResume({
        items: cartItems,
        client: clientePos,
        globalDiscount: 0,
        precioClienteListaId: normalizeClientPriceListIdWithExtras(
          clientePos?.listaPreciosId,
          useInventoryListsStore.getState().listasPrecioExtra
        ),
      });
      setSaleFromQuotationId(q.id);
      setQuotationLoadedFolio(q.folio);
      setCotizacionUltimos4('');
      setFormaPago('01');
      addToast({
        type: 'success',
        message: `Cotización ${q.folio} cargada. Elija forma de pago y pulse Cobrar; al cobrar quedará «Ya cobrada».`,
      });
      setMobileTab('cart');
    } catch (e: unknown) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo cargar la cotización',
      });
    } finally {
      setCotizacionBusy(false);
    }
  };

  const descartarCotizacionCargada = () => {
    setSaleFromQuotationId(null);
    setQuotationLoadedFolio(null);
    void finalizePosCartAfterSale();
    addToast({ type: 'info', message: 'Carrito vaciado. La cotización sigue pendiente en Cotizaciones.' });
  };

  const handleProcessSale = async () => {
      if (formaPago === 'DEV') {
      if (!devolucionSaleResuelta || devolucionSaleResuelta.estado !== 'completada') {
        addToast({ type: 'error', message: 'Busque y valide un ticket completado antes de devolver.' });
        return;
      }
      if (items.length > 0) {
        addToast({
          type: 'warning',
          message: 'Vacíe el carrito: la devolución usa solo el folio del ticket, no líneas nuevas.',
        });
        return;
      }
      const returns: DevolucionLineInput[] = [];
      for (const p of devolucionSaleResuelta.productos) {
        const q = Number(devolucionLineasQty[p.id]) || 0;
        if (q > 0) returns.push({ lineId: p.id, cantidad: q });
      }
      if (returns.length === 0) {
        addToast({ type: 'error', message: 'Indique qué artículos devuelve (cantidad mayor a 0 en al menos una línea).' });
        return;
      }
      setProcessingSale(true);
      try {
        const out = await ejecutarDevolucionParcial(devolucionSaleResuelta.id, {
          returns,
          motivo: 'Devolución en punto de venta',
        });
        const monto = out.reembolso;
        const lineas = buildDevolucionTicketLineas(devolucionSaleResuelta, returns);
        const totOrig = Number(devolucionSaleResuelta.total) || 1;
        const ratio = monto / totOrig;
        const cajeroNombre =
          user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
        const acreditar =
          devolucionAcreditarCuenta && Boolean(devolucionClienteIdAcreditable);
        let saldoCreditoNuevo: number | undefined;
        if (acreditar && devolucionClienteIdAcreditable) {
          const credito = await emitirCreditoTienda(devolucionClienteIdAcreditable, monto, {
            usuarioNombre: cajeroNombre,
            usuarioId: user?.id,
            motivo: 'devolucion_sin_reembolso',
            referencia: devolucionSaleResuelta.folio,
            notas: out.kind === 'partial' ? 'Devolución parcial en POS' : 'Devolución total en POS',
            cajaSesionId: cajaSesion.activa?.id,
          });
          saldoCreditoNuevo = credito.saldoNuevo;
          const fechaLabel = formatInAppTimezone(new Date(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          const clienteNombre =
            devolucionSaleResuelta.cliente?.nombre?.trim() || POS_GENERIC_CLIENT_LABEL;
          const creditoPrint = {
            fechaLabel,
            sucursalId: effectiveSucursalId ?? undefined,
            cajeroNombre,
            clienteNombre,
            montoCredito: monto,
            saldoAnterior: credito.saldoAnterior,
            saldoNuevo: credito.saldoNuevo,
            motivoLabel: labelCreditoTiendaMotivo('devolucion_sin_reembolso'),
            notas: `Ticket ${devolucionSaleResuelta.folio}`,
          };
          printThermalClientCreditoReceipt(creditoPrint);
          printThermalClientCreditoReceipt({ ...creditoPrint, copiaCliente: true });
          await refreshClients();
        }
        const devolucionTicketSnap: PosTicketSnapshot = {
          clienteNombre: devolucionSaleResuelta.cliente?.nombre?.trim() || POS_GENERIC_CLIENT_LABEL,
          cajeroNombre,
          lineas,
          subtotal: (Number(devolucionSaleResuelta.subtotal) || 0) * ratio,
          impuestos: (Number(devolucionSaleResuelta.impuestos) || 0) * ratio,
          total: monto,
          cambio: 0,
          sucursalId: effectiveSucursalId,
          folio: undefined,
          modoDevolucion: true,
          folioVentaOrigen: devolucionSaleResuelta.folio,
          devolucionParcial: out.kind === 'partial',
          notas: acreditar
            ? out.kind === 'partial'
              ? `DEVOLUCIÓN PARCIAL: ${formatMoney(monto)} acreditados a crédito de tienda. Saldo disponible: ${formatMoney(saldoCreditoNuevo ?? monto)}.`
              : `DEVOLUCIÓN: ${formatMoney(monto)} acreditados a crédito de tienda. Saldo disponible: ${formatMoney(saldoCreditoNuevo ?? monto)}.`
            : out.kind === 'partial'
              ? `DEVOLUCIÓN PARCIAL: Reembolso ${formatMoney(monto)}. El ticket original se actualizó (líneas y cobros).`
              : 'DEVOLUCIÓN: Entregue al cliente el importe indicado. El ticket original quedó cancelado por devolución.',
          resumenPagos: acreditar
            ? [{ label: 'Crédito de tienda (devolución)', monto }]
            : [{ label: 'Reembolso (devolución)', monto }],
        };
        setTicketSnapshot(devolucionTicketSnap);
        printPosTicketSnapshot(devolucionTicketSnap);
        setDevolucionFolioInput('');
        setDevolucionSaleResuelta(null);
        setDevolucionLineasQty({});
        setDevolucionAcreditarCuenta(false);
        setFormaPago('01');
        void finalizePosCartAfterSale();
        setCheckoutPhase('success');
        addToast({
          type: 'success',
          message: acreditar
            ? `Devolución registrada. Crédito de tienda: ${formatMoney(monto)}${saldoCreditoNuevo != null ? ` (saldo ${formatMoney(saldoCreditoNuevo)})` : ''}`
            : `Devolución registrada. Reembolso al cliente: ${formatMoney(monto)}`,
        });
      } catch (error: unknown) {
        addToast({
          type: 'error',
          message: error instanceof Error ? error.message : 'Error al procesar la devolución',
        });
      } finally {
        setProcessingSale(false);
      }
      return;
    }

    if (formaPago === 'COT') {
      addToast({
        type: 'warning',
        message:
          'Cotización solo sirve para cargar el pedido: ingrese los 4 dígitos, pulse Buscar y luego elija la forma de pago con la que cobrará.',
      });
      return;
    }

    /** Sin líneas no debe registrarse cobro: antes se llamaba `addPago` y luego se abortaba, dejando `pagos` huérfanos que se sumaban al siguiente ticket. */
    if (items.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos al carrito' });
      return;
    }

    const cobroTarjetaPueLocal =
      !esTraspasoTienda && esFormaTarjeta(formaPago) && metodoPago === 'PUE';

    /** Pago mixto (varios medios en un solo ticket): true si en esta invocación se añadió un abono desde el campo. */
    let pagoAgregadoEnEstaInvocacion = false;

    if (formaPago !== 'PPC' && !esTraspasoTienda && !cobroTarjetaPueLocal) {
      if (metodoPago === 'PPD') {
        const fpLinea = ppdAbonoFormaPago;
        const norm = montoRecibidoInput.replace(',', '.').trim();
        if (norm) {
          let m = parseFloat(norm);
          if (Number.isFinite(m) && m > 0) {
            if (fpLinea === 'STC') {
              m = montoStcCapped(m);
              if (m <= 0.005) {
                addToast({
                  type: 'warning',
                  message: 'No hay crédito de tienda suficiente para este abono',
                });
                return;
              }
            }
            addPago({ formaPago: fpLinea, monto: m });
            pagoAgregadoEnEstaInvocacion = true;
            setMontoRecibidoInput('');
          }
        }
      } else if (
        metodoPago === 'PUE' &&
        !esFormaDevolucion &&
        !esFormaCotizacion
      ) {
        /** PUE: aplica el importe del campo (efectivo, transferencia, etc.) como abono antes de validar. */
        const norm = montoRecibidoInput.replace(',', '.').trim();
        if (norm) {
          let m = parseFloat(norm);
          if (Number.isFinite(m) && m > 0) {
            if (formaPago === 'STC') {
              m = montoStcCapped(m);
              if (m <= 0.005) {
                addToast({
                  type: 'warning',
                  message: 'No hay crédito de tienda suficiente para este abono',
                });
                return;
              }
            }
            addPago({ formaPago, monto: m });
            pagoAgregadoEnEstaInvocacion = true;
            setMontoRecibidoInput('');
          }
        }
      }
    }

    if (formaPago === 'PPC') {
      if (!client?.id || client.id === 'mostrador' || client.isMostrador) {
        addToast({
          type: 'error',
          message: 'Seleccione un cliente registrado para vender con pendiente de pago.',
        });
        return;
      }
    }

    /** Tras `addPago` en este mismo handler, el `pagos` del render sigue desactualizado; el store ya tiene el abono. */
    let pagosParaVenta =
      formaPago === 'PPC' ? [] : [...useCartStore.getState().pagos];

    if (cobroTarjetaPueLocal) {
      pagosParaVenta = [{ formaPago, monto: cobroReferencia }];
    } else if (!esTraspasoTienda) {
      const permiteDeuda = puedeVentaConSaldoPendiente || formaPago === 'PPC';
      const totalPagadoTrasAbono = useCartStore.getState().getTotalPagado();
      const incompleto = totalPagadoTrasAbono + 0.004 < cobroReferencia;
      /**
       * Abono parcial en esta invocación (Enter/Completar con monto): siempre quedar en el diálogo
       * para permitir pago mixto (efectivo + tarjeta). Cerrar con saldo CxC solo si Completar
       * sin monto nuevo en el campo (`!pagoAgregadoEnEstaInvocacion` + permiteDeuda).
       */
      if (
        incompleto &&
        pagoAgregadoEnEstaInvocacion &&
        (metodoPago === 'PPD' || metodoPago === 'PUE')
      ) {
        const restante = Math.max(0, cobroReferencia - totalPagadoTrasAbono);
        if (metodoPago === 'PUE') setMetodoPago('PPD');
        addToast({
          type: 'success',
          message: `Abono registrado. Falta ${formatMoney(restante)}`,
        });
        return;
      }
      if (incompleto && !permiteDeuda) {
        addToast({ type: 'error', message: 'El pago es insuficiente' });
        return;
      }
    }

    const sumPagosCobro = esTraspasoTienda
      ? 0
      : pagosParaVenta.reduce((s, p) => s + (Number(p.monto) || 0), 0);
    /** Misma tolerancia que `computeSaleClienteAdeudo`: evita CxC por centavos de redondeo. */
    const rawAdeudoCobro = cobroReferencia - sumPagosCobro;
    const adeudoTicket =
      esTraspasoTienda ? 0
      : rawAdeudoCobro <= 0.02 ? 0
      : Math.max(0, Math.round(rawAdeudoCobro * 100) / 100);

    const metodoPagoVenta: 'PUE' | 'PPD' =
      formaPago === 'PPC' ? 'PPD'
      : adeudoTicket <= 0 ? 'PUE'
      : (metodoPago as 'PUE' | 'PPD');

    if (formaPago === 'TTS') {
      if (!isAdmin) {
        addToast({ type: 'error', message: 'Solo un administrador puede usar traspaso entre tiendas' });
        return;
      }
      if (!transferenciaDestinoSucursalId?.trim()) {
        addToast({ type: 'error', message: 'Seleccione la tienda destino del traspaso' });
        return;
      }
    }

    if (cajaSesion.mustOpenCajaToSell && !cajaSesion.activa) {
      addToast({
        type: 'warning',
        message: 'Abra caja con «Abrir caja» antes de cobrar en esta tienda.',
      });
      return;
    }

    const stcEnCobro = sumCreditoTiendaEnPagosParcial(
      pagosParaVenta as Pick<Payment, 'formaPago' | 'monto'>[]
    );
    if (stcEnCobro > 0.005) {
      const cid = client?.id?.trim();
      if (!cid || cid === 'mostrador' || client?.isMostrador) {
        addToast({
          type: 'error',
          message: 'Seleccione un cliente registrado para usar crédito de tienda.',
        });
        return;
      }
      const fresh = (await getClientById(cid)) ?? client;
      const disponible = saldoCreditoCliente(fresh);
      if (stcEnCobro > disponible + 0.001) {
        addToast({
          type: 'error',
          message: `Crédito de tienda insuficiente. Disponible: ${formatMoney(disponible)}`,
        });
        return;
      }
    }

    setProcessingSale(true);

    try {
      const cajeroNombre =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
      const clienteVentaSnapshot = buildClienteSnapshotParaVenta(
        checkoutClienteNombre,
        client,
        openSaleResume?.sale?.cliente ?? null
      );
      const clienteNombreVenta = resolveCheckoutClienteNombre(
        checkoutClienteNombre,
        client,
        openSaleResume?.sale?.cliente ?? null
      );

      if (openSaleResume?.sale) {
        let pend = openSaleResume.sale;
        if (pend.estado === 'pendiente') {
          const saved = await persistOpenSaleEdits();
          if (!saved) {
            addToast({
              type: 'error',
              message: 'No se pudo guardar la venta abierta antes de cobrar.',
            });
            return;
          }
          pend = saved;
        }

        const cajaSesionIdHoy = cajaSesion.activa?.id;
        const pagosCompletacion: Payment[] = pagosParaVenta.map((p) => ({
          id: crypto.randomUUID(),
          formaPago: p.formaPago as FormaPago,
          monto: p.monto,
          referencia: p.referencia,
          ...(cajaSesionIdHoy ? { cajaSesionId: cajaSesionIdHoy } : {}),
        }));

        if (pend.estado === 'completada') {
          const adeudoAntes = computeSaleClienteAdeudo(pend);
          const sumAbono = pagosCompletacion.reduce((s, p) => s + (Number(p.monto) || 0), 0);
          const cambioCxC = Math.max(0, sumAbono - adeudoAntes);
          // Cobro de saldo: el dinero cuenta HOY (sesión abierta), no el día de la venta.
          const pagosCxCHoy: Payment[] = pagosCompletacion.map((p) => ({
            ...p,
            esAbonoCxC: true,
          }));
          await appendPagosToCompletedSale(pend.id, {
            pagosToAdd: pagosCxCHoy,
            cambio: cambioCxC,
            cajaSesionId: cajaSesionIdHoy,
            reassignCajaSesion: false,
            skipClientSaldoAdjust: false,
          });

          if (effectiveSucursalId && cajaSesionIdHoy) {
            for (const p of pagosCxCHoy) {
              const monto = Number(p.monto) || 0;
              if (monto <= 0.005) continue;
              try {
                await registrarAbonoCobroCajaFirestore(effectiveSucursalId, cajaSesionIdHoy, {
                  monto,
                  formaPago: p.formaPago,
                  clienteId: pend.clienteId,
                  clienteNombre: clienteNombreVenta,
                  usuarioId: user?.id ?? 'system',
                  usuarioNombre: cajeroNombre || 'Usuario',
                });
              } catch (cajaErr) {
                addToast({
                  type: 'warning',
                  message:
                    cajaErr instanceof Error
                      ? `Cobro guardado, pero no se reflejó en caja: ${cajaErr.message}`
                      : 'Cobro guardado; no se pudo registrar en el corte de caja',
                });
              }
            }
          }

          const clienteNombre = clienteNombreVenta;
          const lineas = items.map((item) => {
            const unitSinIva = cartLineUnitSinIva(item, precioClienteListaId);
            const imp = Number(item.product.impuesto) || 16;
            const unitConIva = unitSinIva * (1 + imp / 100);
            const lineTot = unitConIva * item.quantity;
            return {
              descripcion: item.product.nombre,
              cantidad: item.quantity,
              precioUnit: unitConIva,
              total: lineTot,
            };
          });
          const resumenPagosCxC = pagosCompletacion.map((p) => ({
            label: labelFormaPago(p.formaPago),
            monto: p.monto,
          }));
          const ticketSnapCxC: PosTicketSnapshot = {
            clienteNombre,
            cajeroNombre,
            lineas,
            subtotal: subtotalCobro,
            impuestos: impuestosCobro,
            total: totalCobro,
            cambio: cambioCxC,
            adeudoPendiente: adeudoTicket > 0.005 ? adeudoTicket : undefined,
            sucursalId: effectiveSucursalId,
            folio: pend.folio?.trim() || undefined,
            notas: pend.notas ? String(pend.notas) : undefined,
            resumenPagos: resumenPagosCxC,
          };
          setTicketSnapshot(ticketSnapCxC);
          printPosTicketSnapshot(ticketSnapCxC);
          setOpenSaleResume(null);
          void finalizePosCartAfterSale();
          setCheckoutPhase('success');
          addToast({
            type: 'success',
            message:
              adeudoTicket > 0.005
                ? `Cobro registrado. Saldo restante del ticket: ${formatMoney(adeudoTicket)}.`
                : 'Cobro registrado. Saldo del ticket liquidado.',
          });
          return;
        }

        const cambioAbierta = cobroTarjetaPueLocal ? 0 : getCambio();
        await completePendingSale(pend.id, {
          formaPago: formaPago as FormaPago,
          metodoPago: metodoPagoVenta,
          pagos: pagosCompletacion,
          cambio: cambioAbierta,
          usuarioNombreCierre: cajeroNombre,
          cajaSesionId: cajaSesion.activa?.id,
          clienteId: clienteVentaSnapshot.clienteId,
          cliente: clienteVentaSnapshot.cliente ?? null,
        });

        try {
          await markQuotationConvertedWithSaleFromCompletedSale(
            pend.id,
            effectiveSucursalId ?? undefined
          );
        } catch (e) {
          console.error(e);
        }

        const clienteNombre = clienteNombreVenta;
        const lineas = items.map((item) => {
          const unitSinIva = cartLineUnitSinIva(item, precioClienteListaId);
          const imp = Number(item.product.impuesto) || 16;
          const unitConIva = unitSinIva * (1 + imp / 100);
          const lineTot = unitConIva * item.quantity;
          return {
            descripcion: item.product.nombre,
            cantidad: item.quantity,
            precioUnit: unitConIva,
            total: lineTot,
          };
        });
        const resumenPagosAbierta =
          formaPago === 'PPC' ?
            [{ label: 'Pendiente de pago', monto: totalCobro }]
          : pagosParaVenta.map((p) => ({
              label: labelFormaPago(p.formaPago),
              monto: p.monto,
            }));
        const ticketSnapAbierta: PosTicketSnapshot = {
          clienteNombre,
          cajeroNombre,
          lineas,
          subtotal: subtotalCobro,
          impuestos: impuestosCobro,
          total: totalCobro,
          cambio: cambioAbierta,
          adeudoPendiente: adeudoTicket > 0 ? adeudoTicket : undefined,
          sucursalId: effectiveSucursalId,
          folio: pend.folio?.trim() || undefined,
          notas: pend.notas ? String(pend.notas) : undefined,
          resumenPagos: resumenPagosAbierta,
        };
        setTicketSnapshot(ticketSnapAbierta);
        printPosTicketSnapshot(ticketSnapAbierta);
        setOpenSaleResume(null);
        void finalizePosCartAfterSale();
        setCheckoutPhase('success');
        addToast({
          type: 'success',
          message:
            adeudoTicket > 0.005
              ? `Cobro registrado. Saldo pendiente del cliente: ${formatMoney(adeudoTicket)} (ver Cuentas por cobrar).`
              : 'Cobro registrado. Venta completada.',
        });
        return;
      }

      const cambioVentaFinal = esTraspasoTienda ? 0 : cobroTarjetaPueLocal ? 0 : getCambio();

      const destNombre =
        sucursalesCat.find((s) => s.id === transferenciaDestinoSucursalId)?.nombre ??
        transferenciaDestinoSucursalId;
      const saleData = {
        clienteId: clienteVentaSnapshot.clienteId,
        ...(clienteVentaSnapshot.cliente ? { cliente: clienteVentaSnapshot.cliente } : {}),
        productos: buildPendingSaleLineItemsFromCart(items, precioClienteListaId),
        subtotal: subtotalCobro,
        descuento: descuentoCobro,
        impuestos: impuestosCobro,
        total: totalCobro,
        formaPago: formaPago as FormaPago,
        metodoPago: metodoPagoVenta,
        pagos: esTraspasoTienda
          ? [{ id: crypto.randomUUID(), formaPago: 'TTS' as FormaPago, monto: 0 }]
          : pagosParaVenta.map((p) => ({
              id: crypto.randomUUID(),
              formaPago: p.formaPago as FormaPago,
              monto: p.monto,
              referencia: p.referencia,
            })),
        cambio: cambioVentaFinal,
        estado: 'completada' as const,
        notas: esTraspasoTienda
          ? `Traspaso tienda a tienda → ${destNombre}`
          : saleFromQuotationId && quotationLoadedFolio
            ? `Cotización ${quotationLoadedFolio}`
            : '',
        transferenciaSucursalDestinoId: esTraspasoTienda
          ? transferenciaDestinoSucursalId.trim()
          : undefined,
        usuarioId: user?.id || 'system',
        usuarioNombre: cajeroNombre,
        ...(cajaSesion.activa?.id ? { cajaSesionId: cajaSesion.activa.id } : {}),
      };

      const { id: ventaIdNueva, folio: folioVenta } = await addSale(saleData);

      if (saleFromQuotationId) {
        try {
          await markQuotationConvertedWithSale(saleFromQuotationId, ventaIdNueva, {
            sucursalId: effectiveSucursalId ?? undefined,
          });
        } catch (err) {
          console.error(err);
          addToast({
            type: 'warning',
            message:
              'La venta se registró, pero no se pudo marcar la cotización como cobrada. Revise Cotizaciones o intente de nuevo desde soporte.',
          });
        }
        setSaleFromQuotationId(null);
        setQuotationLoadedFolio(null);
      }

      const clienteNombre = clienteNombreVenta;
      const lineas = items.map((item) => {
        const unitSinIva = cartLineUnitSinIva(item, precioClienteListaId);
        const imp = Number(item.product.impuesto) || 16;
        const unitConIva = unitSinIva * (1 + imp / 100);
        const lineTot = unitConIva * item.quantity;
        return {
          descripcion: item.product.nombre,
          cantidad: item.quantity,
          precioUnit: unitConIva,
          total: lineTot,
        };
      });
      const resumenPagos =
        formaPago === 'PPC' ?
          [{ label: 'Pendiente de pago', monto: totalCobro }]
        : !esTraspasoTienda && pagosParaVenta.length > 0
          ? pagosParaVenta.map((p) => ({
              label: labelFormaPago(p.formaPago),
              monto: p.monto,
            }))
          : undefined;

      const ticketSnapVenta: PosTicketSnapshot = {
        clienteNombre,
        cajeroNombre,
        lineas,
        subtotal: subtotalCobro,
        impuestos: impuestosCobro,
        total: totalCobro,
        cambio: cambioVentaFinal,
        adeudoPendiente: adeudoTicket > 0 ? adeudoTicket : undefined,
        sucursalId: effectiveSucursalId,
        folio: folioVenta?.trim() || undefined,
        notas: saleData.notas?.trim() ? String(saleData.notas) : undefined,
        resumenPagos,
      };
      setTicketSnapshot(ticketSnapVenta);
      printPosTicketSnapshot(ticketSnapVenta);
      void finalizePosCartAfterSale();
      // Mismo portal de diálogo: pasar a "success" evita dos Dialog de Radix a la vez (insertBefore/removeChild).
      setCheckoutPhase('success');

      addToast({
        type: 'success',
        message:
          adeudoTicket > 0.005
            ? `Venta completada. Saldo a cuenta del cliente: ${formatMoney(adeudoTicket)}. Consulte Cuentas por cobrar.`
            : 'Venta completada exitosamente',
      });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Error al procesar la venta',
      });
    } finally {
      setProcessingSale(false);
    }
  };

  const handleFinishSale = () => {
    handleCheckoutOpenChange(false);
  };

  /** Escape: cerrar el modal/flujo más reciente; Enter en cobro éxito / listas / etc. se maneja en cada `DialogContent`. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEventFromOpenRadixSelect(e.target)) return;

      if (ventaResetConfirmOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setVentaResetConfirmOpen(false);
        return;
      }
      if (listasPrecioCatalogDialogOpen && !listasPrecioCatalogSaving) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setListasPrecioCatalogDialogOpen(false);
        return;
      }
      if (unitPriceDialogOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeUnitPriceDialog();
        return;
      }
      if (pasarCxcClientePickerSale != null && pasarCxcBusyId == null) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPasarCxcClientePickerSale(null);
        return;
      }
      if (checkoutOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleCheckoutOpenChange(false);
        return;
      }
      if (ventasAbiertasDialogOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setVentasAbiertasDialogOpen(false);
        return;
      }
      if (showClientDialog) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setShowClientDialog(false);
        return;
      }
      if (mobileScannerOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setMobileScannerOpen(false);
        return;
      }
      if (showProductSearch) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setShowProductSearch(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    ventaResetConfirmOpen,
    listasPrecioCatalogDialogOpen,
    listasPrecioCatalogSaving,
    unitPriceDialogOpen,
    pasarCxcClientePickerSale,
    pasarCxcBusyId,
    checkoutOpen,
    ventasAbiertasDialogOpen,
    showClientDialog,
    mobileScannerOpen,
    showProductSearch,
    closeUnitPriceDialog,
    handleCheckoutOpenChange,
  ]);

  const handlePrintTicket = () => {
    if (!ticketSnapshot) return;
    printPosTicketSnapshot(ticketSnapshot);
  };

  const checkoutDevolucionListo =
    checkoutOpen &&
    checkoutPhase === 'payment' &&
    formaPago === 'DEV' &&
    devolucionSaleResuelta?.estado === 'completada' &&
    (previewDevolucion?.reembolso ?? 0) > 0;

  const montoDialogoPrincipal = checkoutDevolucionListo
    ? previewDevolucion?.reembolso ?? 0
    : cobroReferencia;

  /** Cobro con lista de abonos: el número grande es lo que falta, no el total del ticket. */
  const cobroDialogoMuestraFalta =
    !checkoutDevolucionListo &&
    formaPago !== 'PPC' &&
    !esTraspasoTienda &&
    !cobroTarjetaPue;

  const importeDestacadoCobroDialogo = cobroDialogoMuestraFalta
    ? Math.max(0, Math.round((montoDialogoPrincipal - totalPagadoVenta) * 100) / 100)
    : montoDialogoPrincipal;

  const etiquetaImporteCobroDialogo =
    checkoutDevolucionListo
      ? devolucionAcreditarCuenta && puedeAcreditarDevolucion
        ? 'Total a acreditar a cuenta'
        : 'Total a devolver al cliente'
      : openSaleResume?.sale?.estado === 'completada' && cobroReferencia + 0.01 < totalCobro
        ? 'Saldo a cobrar (cuentas por cobrar)'
        : cobroDialogoMuestraFalta && totalPagadoVenta > 0.005 && importeDestacadoCobroDialogo > 0.02
          ? 'Falta por cobrar'
          : cobroDialogoMuestraFalta && totalPagadoVenta > 0.005 && importeDestacadoCobroDialogo <= 0.02
            ? 'Cobro completo'
            : 'Total a pagar';

  /** Campo «Monto recibido» listo para registrar un abono (pago mixto sin dejar saldo en CxC). */
  const hayCampoMontoParaAbonoValido = useMemo(() => {
    if (formaPago === 'PPC' || esTraspasoTienda || esFormaDevolucion || esFormaCotizacion) return false;
    if (cobroTarjetaPue) return false;
    const norm = montoRecibidoInput.replace(',', '.').trim();
    if (!norm) return false;
    const m = parseFloat(norm);
    if (!Number.isFinite(m) || m <= 0) return false;
    if (metodoPago === 'PPD') return true;
    if (metodoPago === 'PUE') return true;
    return false;
  }, [
    formaPago,
    esTraspasoTienda,
    esFormaDevolucion,
    esFormaCotizacion,
    cobroTarjetaPue,
    montoRecibidoInput,
    metodoPago,
  ]);

  const puedeRegistrarAbonoParcialMixto = useMemo(
    () =>
      !puedeVentaConSaldoPendiente &&
      !esTraspasoTienda &&
      formaPago !== 'PPC' &&
      !checkoutDevolucionListo &&
      (metodoPago === 'PPD' || metodoPago === 'PUE') &&
      hayCampoMontoParaAbonoValido &&
      totalPagadoIncluyeCampoMonto + 0.004 < cobroReferencia,
    [
      puedeVentaConSaldoPendiente,
      esTraspasoTienda,
      formaPago,
      checkoutDevolucionListo,
      metodoPago,
      hayCampoMontoParaAbonoValido,
      totalPagadoIncluyeCampoMonto,
      cobroReferencia,
    ]
  );

  const panelClass =
    'rounded-xl border border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 shadow-sm';

  const posSearchTrim = searchQuery.trim();
  const posSearchEffective = posSearchEffectiveQuery(posSearchTrim);
  const posSearchSettled =
    posSearchEffective.length > 0 && debouncedSearchQuery === posSearchEffective && !productSearchLoading;
  const showPosSearchDropdown = showProductSearch && posSearchTrim.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overscroll-y-contain max-lg:overflow-y-auto lg:overflow-hidden sm:gap-3">
      <CajaPosToolbar
        ref={cajaToolbarRef}
        sales={salesCatalog}
        canUse={hasPermission('ventas:crear')}
        sucursalId={effectiveSucursalId}
        caja={cajaSesion}
        showStatusBar={false}
      />
      {openSaleResume ? (
        <div
          className={cn(
            'flex shrink-0 flex-col gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4'
          )}
        >
          <div className="flex min-w-0 items-start gap-2 sm:items-center">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 sm:mt-0" />
            <p className="text-xs leading-snug text-black dark:text-amber-100 sm:text-sm">
              {openSaleResume.sale.estado === 'completada' ? (
                <>
                  Ticket <span className="font-mono font-semibold">{openSaleResume.sale.folio}</span> con saldo en
                  cuenta. Registre el cobro del saldo y pulse Cobrar (cliente {POS_GENERIC_CLIENT_LABEL} o registrado).
                </>
              ) : (
                <>
                  Retomando venta abierta{' '}
                  <span className="font-mono font-semibold">{openSaleResume.sale.folio}</span>. Puede editar líneas; los
                  cambios se guardan al poco tiempo. Registre el pago y pulse Cobrar.
                </>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-600/40 text-amber-900 hover:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-100"
            onClick={abandonarVentaAbiertaRetomada}
          >
            Salir sin cobrar (venta abierta)
          </Button>
        </div>
      ) : null}

      {saleFromQuotationId && quotationLoadedFolio && !openSaleResume ? (
        <div
          className={cn(
            'flex shrink-0 flex-col gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4'
          )}
        >
          <p className="text-xs leading-snug text-emerald-950 dark:text-emerald-100 sm:text-sm">
            Cotización{' '}
            <span className="font-mono font-semibold">{quotationLoadedFolio}</span> en el carrito. Cobre con la forma
            de pago real; al terminar quedará «Ya cobrada» en Cotizaciones.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-emerald-600/40 text-emerald-900 hover:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-100"
            onClick={descartarCotizacionCargada}
          >
            Vaciar carrito
          </Button>
        </div>
      ) : null}

      {/* Pestañas móvil: una vista completa por pestaña (sin scroll de página) */}
      <div
        className={cn(
          'grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-200/80 dark:border-slate-800/60 bg-slate-100/90 dark:bg-slate-950/80 p-1 lg:hidden'
        )}
      >
        <button
          type="button"
          onClick={() => setMobileTab('cart')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
            mobileTab === 'cart'
              ? 'bg-brand/15 text-brand-to dark:bg-brand/20 dark:text-brand'
              : 'text-slate-600 dark:text-slate-500 hover:bg-slate-200/80 dark:bg-slate-800/50 hover:text-slate-700 dark:text-slate-300'
          )}
        >
          <ShoppingCart className="h-4 w-4 shrink-0" />
          Carrito
          {items.length > 0 ? (
            <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 text-xs text-slate-700 dark:text-slate-300">
              {items.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('checkout')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
            mobileTab === 'checkout'
              ? 'bg-brand/15 text-brand-to dark:bg-brand/20 dark:text-brand'
              : 'text-slate-600 dark:text-slate-500 hover:bg-slate-200/80 dark:bg-slate-800/50 hover:text-slate-700 dark:text-slate-300'
          )}
        >
          <Wallet className="h-4 w-4 shrink-0" />
          Cobro
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3 xl:gap-4 2xl:gap-5">
        {/* Columna carrito + búsqueda */}
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col gap-2 sm:gap-3',
            mobileTab !== 'cart' && 'hidden lg:flex'
          )}
        >
          <div className={cn('shrink-0 p-2 sm:p-3', panelClass)}>
            <div className="relative" ref={productSearchWrapRef}>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
                  <Input
                    ref={searchInputRef}
                    value={searchQuery}
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={showPosSearchDropdown}
                    onChange={onPosSearchChange}
                    onPaste={onPosSearchPaste}
                    onKeyDown={onPosSearchInputKeyDown}
                    onFocus={() => setShowProductSearch(true)}
                    placeholder="Escanear · cant*p. ej. 10* · F2 · ↑↓ · Enter"
                    className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 pl-9 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-600 focus:border-brand/50 sm:h-11 sm:pl-10 md:text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 border-slate-300 bg-slate-100 px-3 text-slate-700 hover:bg-slate-200/80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 lg:hidden"
                  onClick={() => {
                    setShowProductSearch(false);
                    searchInputRef.current?.blur();
                    setMobileScannerOpen(true);
                  }}
                >
                  <ScanLine className="mr-1 h-4 w-4" />
                  Escanear
                </Button>
              </div>

              {showPosSearchDropdown ? (
                <div
                  ref={posSearchListRef}
                  role="listbox"
                  aria-label="Resultados de búsqueda"
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(42dvh,16rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xl sm:mt-2"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {!posSearchSettled ? (
                    <div className="px-3 py-4 text-center text-sm text-slate-600 dark:text-slate-400">
                      Buscando…
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((product, idx) => (
                      <button
                        key={product.id}
                        type="button"
                        role="option"
                        aria-selected={posSearchHighlightIdx === idx}
                        data-pos-search-idx={idx}
                        onMouseEnter={() => setPosSearchHighlightIdx(idx)}
                        onClick={() => handleAddProduct(product)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/50 p-2.5 text-left transition-colors last:border-0 sm:p-3',
                          posSearchHighlightIdx === idx
                            ? 'bg-brand/15 dark:bg-brand/10'
                            : 'hover:bg-slate-200/80 dark:hover:bg-slate-800/50'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-800 dark:text-slate-200">{product.nombre}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-500">SKU: {product.sku}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-bold text-brand">
                            {formatMoney(getProductUnitConIvaForClienteList(product, precioClienteListaId))}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">con IVA</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            IVA{' '}
                            {formatMoney(
                              getProductIvaUnitarioDesdeSinIva(
                                product,
                                getProductUnitSinIvaForClienteList(product, precioClienteListaId)
                              )
                            )}
                          </p>
                          <p
                            className={cn(
                              'text-xs',
                              productEsServicio(product)
                                ? 'text-slate-500 dark:text-slate-500'
                                : product.existencia <= product.existenciaMinima
                                  ? 'text-amber-400'
                                  : 'text-slate-600 dark:text-slate-500'
                            )}
                          >
                            {productEsServicio(product) ? 'Servicio' : `Stk ${product.existencia}`}
                          </p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-slate-600 dark:text-slate-400">
                      Sin coincidencias. Revise nombre, SKU o código de barras.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <Card
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50'
            )}
          >
            <CardHeader className="shrink-0 space-y-0 border-b border-slate-200/80 dark:border-slate-800/50 py-2 sm:py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 sm:text-base">
                <ShoppingCart className="h-4 w-4 text-brand sm:h-5 sm:w-5" />
                <span className="truncate">Carrito</span>
                <span className="ml-auto text-xs font-normal text-slate-600 dark:text-slate-500 sm:text-sm">
                  {items.length} ít.
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {items.length === 0 ? (
                <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-slate-600 dark:text-slate-500">
                  <ShoppingCart className="h-12 w-12 opacity-40 sm:h-16 sm:w-16" />
                  <p className="text-sm">Vacío</p>
                  <p className="text-xs text-slate-600">Busque y agregue productos</p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                  <div className="divide-y divide-slate-200 dark:divide-slate-800/50">
                    {items.map((item) => {
                      const umLine = normalizeClaveUnidadSat(item.product.unidadMedida);
                      const ubicacionSlots = resolveUbicacionesProducto(item.product);
                      return (
                      <div
                        key={item.product.id}
                        className="grid gap-2 p-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3 sm:p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-start gap-1">
                            <UbicacionFisicaNombre
                              product={item.product}
                              variant={isMobile ? 'dialog' : 'popover'}
                              onOpenDialog={setUbicacionDialogProduct}
                              className="min-w-0 max-w-full flex-1 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-800/60"
                              nameClassName="truncate font-medium text-slate-800 underline underline-offset-2 dark:text-slate-200"
                              pinClassName="mt-0.5 h-3.5 w-3.5 text-brand dark:text-brand"
                            />
                            {item.promoLabel ? (
                              <span
                                className="mt-0.5 shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                                title={item.promoLabel}
                              >
                                {item.promoLabel}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setProductDescriptionDialog(item.product)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-to transition-colors hover:bg-brand-to/15 dark:text-brand dark:hover:bg-brand-to/15"
                              aria-label="Ver descripción del producto"
                              title="Descripción"
                            >
                              <Eye className="h-4 w-4" strokeWidth={2.25} />
                            </button>
                          </div>
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-brand dark:text-brand">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                            {ubicacionSlots.length > 0
                              ? `Estante ${ubicacionSlots.join(', ')}`
                              : 'Sin ubicación física'}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-500">
                            <CartLineSkuStockText product={item.product} />
                          </p>
                          <p className="text-xs text-brand/90 sm:text-sm">
                            {formatMoney(
                              cartLineUnitSinIva(item, precioClienteListaId) *
                                (1 + (Number(item.product.impuesto) || 16) / 100)
                            )}{' '}
                            {umLine === 'MTR' ? 'por m' : umLine === 'CMT' ? 'por cm' : 'c/u'}{' '}
                            <span className="text-slate-500 dark:text-slate-400">con IVA</span>
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            IVA{' '}
                            {formatMoney(
                              cartLineUnitSinIva(item, precioClienteListaId) *
                                ((Number(item.product.impuesto) || 16) / 100)
                            )}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                          <div className="flex items-center gap-1">
                            {umLine === 'MTR' || umLine === 'CMT' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      setQtyLineEdit(null);
                                      const step = deltaCantidadBotonMasMenosSat(
                                        item.product.unidadMedida
                                      );
                                      updateQuantity(item.product.id, item.quantity - step);
                                    } catch (err: unknown) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          err instanceof Error
                                            ? err.message
                                            : 'No se pudo actualizar la cantidad',
                                      });
                                    }
                                  }}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 transition-colors hover:bg-slate-700"
                                  aria-label={
                                    umLine === 'MTR' ? 'Menos medio metro' : 'Menos un centímetro'
                                  }
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  className="h-8 min-w-[3.75rem] max-w-[5rem] border-slate-300 bg-slate-200 px-1 text-center text-sm tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  aria-label={
                                    umLine === 'MTR' ? 'Cantidad en metros' : 'Cantidad en centímetros'
                                  }
                                  title={
                                    umLine === 'MTR'
                                      ? 'Use decimales o 0,5 en cada clic (±)'
                                      : 'Cantidad decimal o entera'
                                  }
                                  value={
                                    qtyLineEdit?.productId === item.product.id
                                      ? qtyLineEdit.text
                                      : formatearCantidadLineaVentaSat(
                                          item.product.unidadMedida,
                                          item.quantity
                                        )
                                  }
                                  onFocus={() =>
                                    setQtyLineEdit({
                                      productId: item.product.id,
                                      text: formatearCantidadLineaVentaSat(
                                        item.product.unidadMedida,
                                        item.quantity
                                      ),
                                    })
                                  }
                                  onChange={(e) =>
                                    setQtyLineEdit({
                                      productId: item.product.id,
                                      text: e.target.value,
                                    })
                                  }
                                  onBlur={(e) => {
                                    const raw = e.target.value.trim().replace(',', '.');
                                    const n = parseFloat(raw);
                                    setQtyLineEdit(null);
                                    if (raw === '' || !Number.isFinite(n) || n <= 0) return;
                                    try {
                                      updateQuantity(item.product.id, n);
                                    } catch (err: unknown) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          err instanceof Error
                                            ? err.message
                                            : 'No se pudo actualizar la cantidad',
                                      });
                                    }
                                  }}
                                />
                                <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                  {abrevCantidadVentaPorUnidadSat(item.product.unidadMedida)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      setQtyLineEdit(null);
                                      const step = deltaCantidadBotonMasMenosSat(
                                        item.product.unidadMedida
                                      );
                                      updateQuantity(item.product.id, item.quantity + step);
                                    } catch (err: unknown) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          err instanceof Error
                                            ? err.message
                                            : 'No se pudo actualizar la cantidad',
                                      });
                                    }
                                  }}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 transition-colors hover:bg-slate-700"
                                  aria-label={umLine === 'MTR' ? 'Más medio metro' : 'Más un centímetro'}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      updateQuantity(item.product.id, item.quantity - 1);
                                    } catch (err: unknown) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          err instanceof Error
                                            ? err.message
                                            : 'No se pudo actualizar la cantidad',
                                      });
                                    }
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 transition-colors hover:bg-slate-700"
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="min-w-[3rem] text-center tabular-nums text-sm font-medium">
                                  {formatearCantidadLineaVentaSat(
                                    item.product.unidadMedida,
                                    item.quantity
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      updateQuantity(item.product.id, item.quantity + 1);
                                    } catch (err: unknown) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          err instanceof Error
                                            ? err.message
                                            : 'No se pudo actualizar la cantidad',
                                      });
                                    }
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 transition-colors hover:bg-slate-700"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Percent className="hidden h-3.5 w-3.5 text-slate-600 dark:text-slate-500 sm:block" />
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={
                                lineDiscountFocusProductId === item.product.id && item.discount === 0
                                  ? ''
                                  : item.discount
                              }
                              onFocus={() => setLineDiscountFocusProductId(item.product.id)}
                              onBlur={() => setLineDiscountFocusProductId(null)}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  updateDiscount(item.product.id, 0);
                                  return;
                                }
                                updateDiscount(item.product.id, parseFloat(v) || 0);
                              }}
                              className="h-8 w-14 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-1 text-center text-xs text-slate-900 dark:text-slate-100 sm:w-16"
                              min={0}
                              max={100}
                              aria-label="Descuento porcentaje"
                            />
                          </div>

                          <p className="min-w-[4.5rem] text-right text-sm font-bold text-slate-800 dark:text-slate-200">
                            {formatMoney(cartLineTotalConIva(item, precioClienteListaId))}
                          </p>

                          <button
                            type="button"
                            onClick={() => openUnitPriceDialog(item.product.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-slate-700 transition-colors hover:bg-slate-700 hover:text-white dark:bg-slate-800 dark:text-slate-200"
                            aria-label="Editar precio unitario"
                            title="Editar precio (con IVA)"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => removeItem(item.product.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
                            aria-label="Quitar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Barra rápida móvil: total + ir a cobro */}
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800/60 bg-white/95 dark:bg-slate-950/90 p-2 lg:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-500">
                {openSaleResume?.sale?.estado === 'completada' && cobroReferencia + 0.01 < totalCobro
                  ? 'Saldo a cobrar'
                  : 'Total'}
              </p>
              <p className="truncate text-lg font-bold text-brand">{formatMoney(cobroReferencia)}</p>
            </div>
            <Button
              type="button"
              disabled={items.length === 0}
              onClick={() => setMobileTab('checkout')}
              className="h-10 shrink-0 bg-brand-gradient px-4 text-sm font-semibold text-white shadow-lg shadow-brand/20 disabled:opacity-50"
            >
              Cobrar
            </Button>
          </div>
        </section>

        {/* Columna cobro / resumen */}
        <aside
          className={cn(
            'flex w-full flex-col gap-2 sm:gap-3 lg:gap-1.5',
            'max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-y-contain',
            /* Desktop: sin scroll interno; contenido compacto para ver resumen + cobro + botones */
            'lg:min-h-0 lg:max-h-full lg:w-[min(100%,26rem)] lg:shrink-0 lg:overflow-visible',
            'xl:w-[min(100%,30rem)] 2xl:w-[min(100%,34rem)]',
            mobileTab !== 'checkout' && 'hidden lg:flex'
          )}
        >
          <button
            type="button"
            className={cn(
              'flex w-full shrink-0 items-center justify-between gap-2 p-2 text-left sm:gap-3 sm:p-3 lg:gap-2 lg:p-2',
              panelClass,
              'cursor-pointer transition-colors',
              'hover:border-brand/40 hover:bg-slate-100/95 dark:hover:border-brand/35 dark:hover:bg-slate-800/70',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'
            )}
            onClick={() => {
              void refreshClients();
              setShowClientDialog(true);
            }}
            aria-label={`Cliente: ${posClienteDisplayNombre(client)}. Cambiar cliente`}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/20 sm:h-10 sm:w-10 lg:h-8 lg:w-8">
                <User className="h-4 w-4 text-brand sm:h-5 sm:w-5 lg:h-4 lg:w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-500 sm:text-xs lg:text-[9px]">
                  Cliente
                </p>
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base lg:text-sm">
                  {posClienteDisplayNombre(client)}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-brand-to sm:text-sm dark:text-brand lg:text-xs">
              Cambiar
            </span>
          </button>

          <div className="min-w-0 overflow-x-hidden overscroll-y-contain lg:flex-none lg:overflow-visible">
          <Card className="flex min-w-0 flex-col overflow-visible border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 max-lg:flex-none lg:shrink-0 lg:flex-none lg:overflow-visible">
            <CardContent className="flex flex-col gap-3 overflow-visible p-2 sm:p-3 lg:gap-2 lg:overflow-visible lg:p-2.5">
              <div className="shrink-0 space-y-2 lg:space-y-1">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm lg:gap-x-2 lg:gap-y-0.5 lg:text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Subtotal (sin IVA)</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(subtotalCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">Descuento</span>
                  <span className="text-right text-amber-400">-{formatMoney(descuentoCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">IVA (desglose)</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(impuestosCobro)}</span>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-2 lg:pt-1.5">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base lg:text-sm">
                      {openSaleResume?.sale?.estado === 'completada' && cobroReferencia + 0.01 < totalCobro
                        ? 'Saldo a cobrar'
                        : 'Total'}
                    </span>
                    <span className="text-xl font-bold tabular-nums text-brand sm:text-2xl lg:text-2xl">
                      {formatMoney(cobroReferencia)}
                    </span>
                  </div>
                  {openSaleResume?.sale?.estado === 'completada' && cobroReferencia + 0.01 < totalCobro ? (
                    <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      Importe original del ticket: {formatMoney(totalCobro)}
                    </p>
                  ) : null}
                </div>
                {puedeVentaConSaldoPendiente &&
                cobroReferencia > 0 &&
                totalPagadoVenta + 0.004 < cobroReferencia ? (
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 sm:text-xs">
                    En Cobrar podrá completar con saldo pendiente:{' '}
                    {formatMoney(Math.max(0, cobroReferencia - totalPagadoVenta))}
                  </p>
                ) : null}
                {esTraspasoTienda ? (
                  <p className="text-[10px] text-brand/90 sm:text-xs">
                    Traspaso entre tiendas: cobro $0 (solo administrador). El stock se descuenta en esta
                    sucursal.
                  </p>
                ) : null}
                {esFormaDevolucion ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400/90 sm:text-xs">
                    Devolución: folio, Buscar, ajuste cantidades a devolver (o Todo/Nada), carrito vacío y Cobrar.
                  </p>
                ) : null}
                {esFormaCotizacion ? (
                  <p className="text-[10px] text-brand-to dark:text-brand/90 sm:text-xs">
                    Cotización: últimos 4 dígitos del folio (ej. 0007), Buscar, luego elija efectivo u otra forma y
                    Cobrar. Al cobrar la cotización pasa a «Ya cobrada».
                  </p>
                ) : null}
                {quotationLoadedFolio && saleFromQuotationId && !esFormaCotizacion ? (
                  <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400/90 sm:text-xs">
                    Pedido desde cotización{' '}
                    <span className="font-mono">{quotationLoadedFolio}</span>. Al completar el cobro se actualizará
                    en Cotizaciones.
                  </p>
                ) : null}
              </div>

              {/*
                Controles de pago: en lg sin scroll en el panel; Select sigue en portal Radix.
              */}
              <div className="shrink-0 space-y-3 border-t border-slate-200 dark:border-slate-800/80 pt-3 lg:space-y-2 lg:pt-2">
                <div className="space-y-1 lg:space-y-0.5">
                  <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs lg:text-[10px]">
                    Forma de pago
                  </Label>
                  <Select
                    value={formaPagoSelectValue}
                    onValueChange={(v) => {
                      setFormaPago(v);
                      if (v === 'TTS' && isAdmin) {
                        useCartStore.setState({ pagos: [] });
                      }
                      if (v === 'DEV' || v === 'COT' || v === 'PPC') {
                        useCartStore.setState({ pagos: [] });
                      }
                      if (v !== 'TTS') setTransferenciaDestinoSucursalId('');
                    }}
                  >
                    <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:h-10 md:text-sm lg:h-9 lg:min-h-9 lg:text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      sideOffset={6}
                      hideScrollButtons
                      className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                    >
                      {formasPagoPosEffective.map((fp) => (
                        <SelectItem
                          key={fp.clave}
                          value={fp.clave}
                          className="text-slate-900 dark:text-slate-100"
                        >
                          {fp.descripcion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {esFormaDevolucion ? (
                  <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 sm:p-3">
                    <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">
                      Folio del ticket de compra
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={devolucionFolioInput}
                        onChange={(e) => setDevolucionFolioInput(e.target.value)}
                        placeholder="V-20260322-0001"
                        className="h-10 border-slate-300 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleBuscarTicketDevolucion();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 shrink-0 bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                        disabled={devolucionBusy}
                        onClick={() => void handleBuscarTicketDevolucion()}
                      >
                        {devolucionBusy ? 'Buscando…' : 'Buscar'}
                      </Button>
                    </div>
                    {devolucionSaleResuelta ? (
                      <div className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 sm:text-xs">
                        <p className="font-mono font-medium text-slate-800 dark:text-slate-200">
                          {devolucionSaleResuelta.folio}
                        </p>
                        <p>
                          Total original:{' '}
                          <span className="font-semibold text-brand dark:text-brand">
                            {formatMoney(Number(devolucionSaleResuelta.total) || 0)}
                          </span>
                        </p>
                        {devolucionSaleResuelta.estado === 'completada' ? (
                          <div className="space-y-2">
                            <p className="text-emerald-600 dark:text-emerald-400">
                              Indique cantidades a devolver por artículo (o use «Todo» / «Nada»).
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 text-[11px]"
                                onClick={() => {
                                  const next: Record<string, number> = {};
                                  for (const p of devolucionSaleResuelta.productos) {
                                    next[p.id] = Number(p.cantidad) || 0;
                                  }
                                  setDevolucionLineasQty(next);
                                }}
                              >
                                Todo el ticket
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-[11px]"
                                onClick={() => {
                                  const next: Record<string, number> = {};
                                  for (const p of devolucionSaleResuelta.productos) {
                                    next[p.id] = 0;
                                  }
                                  setDevolucionLineasQty(next);
                                }}
                              >
                                Nada
                              </Button>
                            </div>
                            <ul className="max-h-40 space-y-2 overflow-y-auto overscroll-contain rounded border border-slate-200/80 bg-slate-100/50 p-2 dark:border-slate-700/80 dark:bg-slate-900/40">
                              {devolucionSaleResuelta.productos.map((ln) => {
                                const maxQ = Number(ln.cantidad) || 0;
                                const q = Math.min(
                                  maxQ,
                                  Math.max(0, Number(devolucionLineasQty[ln.id]) || 0)
                                );
                                const nombre =
                                  ln.producto?.nombre?.trim() ||
                                  ln.productoNombre?.trim() ||
                                  `Producto (${String(ln.productId).slice(0, 8)}…)`;
                                return (
                                  <li
                                    key={ln.id}
                                    className="flex flex-col gap-1 rounded border border-transparent bg-white/60 px-2 py-1.5 dark:bg-slate-950/30 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-800 dark:text-slate-200">
                                      {nombre}
                                    </span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <Label className="sr-only" htmlFor={`devq-${ln.id}`}>
                                        Cantidad a devolver
                                      </Label>
                                      <Input
                                        id={`devq-${ln.id}`}
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={maxQ}
                                        step={1}
                                        value={q === 0 ? '' : String(q)}
                                        onChange={(e) => {
                                          const raw = e.target.value.replace(/[^\d]/g, '');
                                          if (raw === '') {
                                            setDevolucionLineasQty((prev) => ({ ...prev, [ln.id]: 0 }));
                                            return;
                                          }
                                          const n = Math.min(maxQ, Math.max(0, parseInt(raw, 10) || 0));
                                          setDevolucionLineasQty((prev) => ({ ...prev, [ln.id]: n }));
                                        }}
                                        className="h-8 w-16 border-slate-300 text-center font-mono text-xs dark:border-slate-600"
                                      />
                                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                        / {maxQ}
                                      </span>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            {previewDevolucion && previewDevolucion.reembolso > 0 ? (
                              <>
                                <p className="text-[11px] font-medium text-brand dark:text-brand">
                                  {devolucionAcreditarCuenta && puedeAcreditarDevolucion
                                    ? 'Crédito estimado'
                                    : 'Reembolso estimado'}
                                  : {formatMoney(previewDevolucion.reembolso)}
                                  {previewDevolucion.kind === 'partial' ?
                                    ' (devolución parcial)'
                                  : ' (ticket completo)'}
                                </p>
                                {puedeAcreditarDevolucion ? (
                                  <div className="mt-2 space-y-1.5 rounded-md border border-violet-500/25 bg-violet-500/5 p-2">
                                    <Label className="text-[10px] text-slate-600 dark:text-slate-400">
                                      ¿Cómo devolver al cliente?
                                    </Label>
                                    <div className="flex flex-col gap-1.5 sm:flex-row">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={devolucionAcreditarCuenta ? 'outline' : 'default'}
                                        className="h-8 flex-1 text-xs"
                                        onClick={() => setDevolucionAcreditarCuenta(false)}
                                      >
                                        Efectivo / reembolso
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={devolucionAcreditarCuenta ? 'default' : 'outline'}
                                        className="h-8 flex-1 bg-violet-600 text-xs text-white hover:bg-violet-500"
                                        onClick={() => setDevolucionAcreditarCuenta(true)}
                                      >
                                        Acreditar a cuenta
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <p className="text-[11px] text-black dark:text-amber-100">
                                Ajuste las cantidades para ver el reembolso.
                              </p>
                            )}
                          </div>
                        ) : devolucionSaleResuelta.estado === 'cancelada' ? (
                          <p className="text-black dark:text-amber-100">
                            {devolucionSaleResuelta.cancelacionMotivo === 'devolucion' ?
                              'Ya cancelado por devolución.'
                            : 'Venta cancelada.'}
                          </p>
                        ) : (
                          <p className="text-black dark:text-amber-100">No aplica para devolución en POS.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {esFormaCotizacion ? (
                  <div className="space-y-2 rounded-lg border border-brand/25 bg-brand/5 p-2.5 sm:p-3">
                    <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">
                      Últimos 4 dígitos del folio de cotización
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0007"
                        maxLength={8}
                        value={cotizacionUltimos4}
                        onChange={(e) =>
                          setCotizacionUltimos4(e.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleBuscarCotizacion();
                          }
                        }}
                        className="h-10 border-slate-300 font-mono text-sm tracking-wider dark:border-slate-700 dark:bg-slate-800"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 shrink-0 bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                        disabled={cotizacionBusy}
                        onClick={() => void handleBuscarCotizacion()}
                      >
                        {cotizacionBusy ? 'Buscando…' : 'Buscar'}
                      </Button>
                    </div>
                    <p className="text-[10px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                      Ej. folio <span className="font-mono">C-20260323-0007</span> → escriba{' '}
                      <span className="font-mono">0007</span>.
                    </p>
                  </div>
                ) : null}

                {formaPago === 'TTS' && isAdmin ? (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">Tienda destino</Label>
                    <Select
                      value={transferenciaDestinoSucursalId || '__none__'}
                      onValueChange={(v) =>
                        setTransferenciaDestinoSucursalId(v === '__none__' ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:text-sm lg:h-9 lg:min-h-9 lg:text-xs">
                        <SelectValue placeholder="Seleccione tienda" />
                      </SelectTrigger>
                      <SelectContent
                        align="start"
                        sideOffset={6}
                        hideScrollButtons
                        className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                      >
                        <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                          Seleccione…
                        </SelectItem>
                        {otrasSucursales.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-slate-900 dark:text-slate-100">
                            {s.codigo ? `${s.nombre} (${s.codigo})` : s.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {esFormaPendientePago ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-snug text-black dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-100 sm:text-xs">
                    <span className="font-semibold">Pendiente de pago:</span> se registrará el total como saldo del
                    cliente (aparece en Cuentas por cobrar con el folio del ticket). Elija un cliente registrado, no{' '}
                    {POS_GENERIC_CLIENT_LABEL}.
                  </p>
                ) : (
                  <div className="space-y-1 lg:space-y-0.5">
                    <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs lg:text-[10px]">
                      Método
                    </Label>
                    <Select value={metodoPagoSelectValue} onValueChange={setMetodoPago}>
                      <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:text-sm lg:h-9 lg:min-h-9 lg:text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        align="start"
                        sideOffset={6}
                        hideScrollButtons
                        className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                      >
                        <SelectItem value="PUE" className="text-slate-900 dark:text-slate-100">
                          Una exhibición (PUE)
                        </SelectItem>
                        <SelectItem value="PPD" className="text-slate-900 dark:text-slate-100">
                          Parcialidades (PPD)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {metodoPago === 'PPD' &&
                client &&
                client.id !== 'mostrador' &&
                !client.isMostrador &&
                !esTraspasoTienda &&
                !esFormaDevolucion &&
                !esFormaCotizacion &&
                !esFormaPendientePago ? (
                  <p className="text-[10px] leading-snug text-slate-600 dark:text-slate-400 sm:text-xs">
                    Con <span className="font-medium">Parcialidades (PPD)</span> puede registrar un pago menor al
                    total o ninguno: el faltante queda en la cuenta del cliente (Cuentas por cobrar). Use{' '}
                    <span className="font-medium">Una exhibición (PUE)</span> si cobra el importe completo al
                    momento.
                  </p>
                ) : null}

                {!esFormaDevolucion && !esFormaCotizacion ? (
                  <div className="grid gap-3 lg:grid-cols-2 lg:gap-2">
                    <div className="space-y-1 lg:space-y-0.5">
                      <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs lg:text-[10px]">
                        Desc. global %
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={globalDiscFocus && discount === 0 ? '' : discount}
                        onFocus={() => setGlobalDiscFocus(true)}
                        onBlur={() => {
                          setGlobalDiscFocus(false);
                        }}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') setGlobalDiscount(0);
                          else setGlobalDiscount(parseFloat(v) || 0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.preventDefault();
                        }}
                        className="h-10 w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:h-10 md:text-sm lg:h-9 lg:text-xs"
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="relative z-10 shrink-0 space-y-1.5 pb-1 lg:space-y-0.5 lg:pb-0">
                      <Label className="block whitespace-normal text-[10px] leading-snug text-slate-600 dark:text-slate-400 sm:text-xs lg:text-[10px]">
                        Precios por cliente
                      </Label>
                      <Select
                        value={precioClienteListaSelectValue}
                        onValueChange={(v) => setPrecioClienteLista(v as ClientPriceListId)}
                      >
                        <SelectTrigger className="h-10 w-full min-h-10 min-w-0 shrink-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:text-sm lg:h-9 lg:min-h-9 lg:text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          sideOffset={6}
                          hideScrollButtons
                          className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                        >
                          {priceListCatalog.entries.map(({ id, label }) => (
                            <SelectItem key={id} value={id} className="text-slate-900 dark:text-slate-100">
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
          </div>

          <div className="max-lg:mt-1 shrink-0 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={() => openCheckoutDialog()}
                disabled={
                esFormaDevolucion ?
                  !devolucionSaleResuelta ||
                  devolucionSaleResuelta.estado !== 'completada' ||
                  items.length > 0 ||
                  !previewDevolucion ||
                  previewDevolucion.reembolso <= 0
                : esFormaCotizacion
                  ? true
                  : items.length === 0 ||
                    (formaPago === 'TTS' && isAdmin && !transferenciaDestinoSucursalId?.trim()) ||
                    (formaPago === 'PPC' &&
                      (!client || client.id === 'mostrador' || client.isMostrador))
              }
              className="h-11 w-full min-w-0 rounded-xl bg-brand-gradient text-base font-bold text-white shadow-lg shadow-brand/25 sm:h-12 md:h-14 md:text-lg"
            >
              Cobrar
            </Button>

            <Button
              type="button"
              onClick={() => setVentaResetConfirmOpen(true)}
              variant="outline"
              className="h-10 w-full rounded-xl border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-800 dark:text-slate-200 sm:h-11"
            >
              <X className="mr-2 h-4 w-4" />
              Cancelar venta
            </Button>

            <Button
              type="button"
              onClick={() => void handleDejarVentaAbierta()}
              disabled={
                dejarAbiertaBusy ||
                resumeOpenBusy ||
                Boolean(openSaleResume) ||
                Boolean(saleFromQuotationId) ||
                items.length === 0 ||
                esTraspasoTienda ||
                esFormaDevolucion
              }
              variant="secondary"
              className="h-10 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 text-black hover:bg-amber-500/20 dark:border-amber-500/35 dark:text-amber-100 dark:hover:bg-amber-500/15 sm:h-11 lg:h-9 lg:text-sm"
            >
              <Clock className="mr-2 h-4 w-4 shrink-0" />
              {dejarAbiertaBusy ? 'Guardando…' : 'Dejar venta abierta (fiado)'}
            </Button>

            {hasPermission('ventas:crear') && cajaSesion.activa ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => cajaToolbarRef.current?.openArqueoDialog()}
                className="h-10 w-full rounded-xl border-amber-500/40 text-amber-900 hover:bg-amber-500/10 dark:border-amber-500/45 dark:text-amber-100 dark:hover:bg-amber-500/15 sm:h-11 lg:h-9 lg:text-sm"
              >
                <ClipboardCheck className="mr-2 h-4 w-4 shrink-0" />
                Arqueo
              </Button>
            ) : null}
          </div>
        </aside>
      </div>

      <Dialog open={ventasAbiertasDialogOpen} onOpenChange={setVentasAbiertasDialogOpen}>
        <DialogContent className="max-h-[min(85dvh,calc(100dvh-4rem))] w-[min(calc(100vw-1.5rem),24rem)] border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ClipboardList className="h-5 w-5 shrink-0 text-amber-500" />
              Ventas abiertas
            </DialogTitle>
            <p className="text-left text-xs font-normal text-slate-600 dark:text-slate-400">
              Pendiente de pago. Toque una fila para cargarla en el carrito y cobrar.{' '}
              <span className="text-slate-500 dark:text-slate-500">
                «Pasar a cuentas por cobrar» con {POS_GENERIC_CLIENT_LABEL} pedirá elegir el cliente deudor.
              </span>
            </p>
          </DialogHeader>
          {ventasAbiertas.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400">
              No hay ventas abiertas en esta sucursal.
            </p>
          ) : (
            <ul className="max-h-[min(50dvh,22rem)] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {ventasAbiertas.map((vs) => {
                const filaBusy = resumeOpenBusy || dejarAbiertaBusy || pasarCxcBusyId === vs.id;
                return (
                  <li key={vs.id} className="space-y-2">
                    <button
                      type="button"
                      disabled={filaBusy}
                      onClick={() => void resumeOpenSale(vs)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-xl border border-slate-200/90 bg-slate-200/60 px-3 py-2.5 text-left transition-colors hover:border-brand/45 hover:bg-slate-200/90 dark:border-slate-700/90 dark:bg-slate-800/60 dark:hover:border-brand/40 dark:hover:bg-slate-800/90',
                        filaBusy && 'pointer-events-none opacity-50'
                      )}
                    >
                      <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
                        {vs.folio}
                      </span>
                      <span className="truncate text-xs text-slate-600 dark:text-slate-400">
                        {vs.cliente?.nombre?.trim() || vs.clienteId || 'Cliente'}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-brand dark:text-brand">
                        {formatMoney(Number(vs.total) || 0)}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-500">
                        {formatInAppTimezone(
                          vs.createdAt instanceof Date ? vs.createdAt : new Date(vs.createdAt),
                          { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
                        )}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={filaBusy}
                      title={
                        vs.clienteId === 'mostrador' || vs.cliente?.isMostrador
                          ? 'Elegir cliente deudor para registrar el adeudo'
                          : 'Completar como pendiente de pago y abrir Cuentas por cobrar'
                      }
                      className="h-8 w-full border-amber-500/40 text-xs text-amber-900 hover:bg-amber-500/10 dark:border-amber-500/35 dark:text-amber-100 disabled:opacity-40"
                      onClick={() => void pasarVentaACuentasPorCobrar(vs)}
                    >
                      {pasarCxcBusyId === vs.id ? 'Procesando…' : 'Pasar a cuentas por cobrar'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 dark:border-slate-600"
              onClick={() => setVentasAbiertasDialogOpen(false)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pasarCxcClientePickerSale != null}
        onOpenChange={(o) => {
          if (!o) setPasarCxcClientePickerSale(null);
        }}
      >
        <DialogContent className="flex max-h-[min(88dvh,32rem)] w-[min(calc(100vw-1.5rem),24rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Cliente para cuentas por cobrar</DialogTitle>
            <p className="text-left text-xs font-normal text-slate-600 dark:text-slate-400">
              Venta{' '}
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {pasarCxcClientePickerSale?.folio}
              </span>
              . Elija a quién se cargará el adeudo.
            </p>
          </DialogHeader>
          <div className="shrink-0 px-1 pb-2">
            <Input
              placeholder="Buscar nombre o RFC…"
              value={pasarCxcClienteSearch}
              onChange={(e) => setPasarCxcClienteSearch(e.target.value)}
              className="border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-1 pb-2">
            {clientesFiltradosParaCxc.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">
                Ningún cliente coincide. Registre clientes en Clientes o ajuste la búsqueda.
              </p>
            ) : (
              clientesFiltradosParaCxc.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={pasarCxcBusyId != null}
                  onClick={() => {
                    const vs = pasarCxcClientePickerSale;
                    if (!vs) return;
                    void ejecutarPasarCxcConCliente(vs, c);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-200/80 p-3 text-left transition-colors hover:bg-slate-200 dark:border-slate-700/80 dark:bg-slate-800/50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <p className="font-medium text-slate-800 dark:text-slate-200">{c.nombre}</p>
                  {c.rfc ? (
                    <p className="text-xs text-slate-600 dark:text-slate-500">RFC: {c.rfc}</p>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 pt-3 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 dark:border-slate-600"
              onClick={() => setPasarCxcClientePickerSale(null)}
              disabled={pasarCxcBusyId != null}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checkoutOpen} onOpenChange={handleCheckoutOpenChange}>
        <DialogContent
          className={cn(
            'left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100',
            checkoutPhase === 'payment'
              ? 'max-h-[min(88dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-4.5rem))] w-[min(calc(100vw-1rem),28rem)] min-w-0 overflow-y-auto overflow-x-auto overscroll-y-contain px-4 py-4 pl-4 pr-12 sm:top-[50%] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[min(calc(100vw-2rem),32rem)] sm:p-6 sm:pr-14 md:w-[min(calc(100vw-2rem),40rem)] lg:w-[min(calc(100vw-2rem),48rem)] md:overflow-x-hidden'
              : 'w-[min(calc(100vw-1rem),24rem)] min-w-0 px-4 py-4 pl-4 pr-12 sm:max-w-sm sm:p-6 sm:pr-14 md:w-[min(calc(100vw-2rem),28rem)]'
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && checkoutPhase === 'success') {
              const t = e.target as HTMLElement;
              if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'A')
                return;
              e.preventDefault();
              handleFinishSale();
              return;
            }
            if (checkoutPhase !== 'payment' || e.key !== 'Enter' || processingSale) return;
            const t = e.target as HTMLElement;
            if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
            if (t.closest('[data-radix-select-content]') || t.getAttribute('role') === 'option') return;
            e.preventDefault();
            void handleProcessSale();
          }}
        >
          {checkoutPhase === 'payment' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Receipt className="h-5 w-5 text-brand sm:h-6 sm:w-6" />
                  {checkoutDevolucionListo ? 'Confirmar devolución' : formaPago === 'PPC' ? 'Pendiente de pago' : 'Procesar pago'}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-1 sm:space-y-4 sm:py-2">
                <div className="rounded-xl bg-slate-200/80 dark:bg-slate-800/50 p-3 text-center sm:p-4">
                  <p className="mb-1 text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
                    {etiquetaImporteCobroDialogo}
                  </p>
                  <p className="text-2xl font-bold text-brand sm:text-4xl">
                    {formatMoney(importeDestacadoCobroDialogo)}
                  </p>
                  {cobroDialogoMuestraFalta && totalPagadoVenta > 0.005 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Total del ticket {formatMoney(montoDialogoPrincipal)} · Abonado {formatMoney(totalPagadoVenta)}
                    </p>
                  ) : null}
                </div>

                {!checkoutDevolucionListo &&
                formaPago !== 'PPC' &&
                puedeVentaConSaldoPendiente &&
                montoDialogoPrincipal > 0 &&
                totalPagadoVenta + 0.004 < montoDialogoPrincipal ? (
                  <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-400">
                    Quedará a cuenta del cliente:{' '}
                    {formatMoney(Math.max(0, montoDialogoPrincipal - totalPagadoVenta))}
                  </p>
                ) : null}

                {formaPago === 'PPC' && !checkoutDevolucionListo ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-center text-xs leading-relaxed text-black dark:border-amber-500/30 dark:bg-amber-950/35 dark:text-amber-100 sm:text-sm">
                    No se registrará cobro en caja. El importe total quedará como saldo del cliente y el ticket se
                    listará en <span className="font-semibold">Cuentas por cobrar</span>.
                  </p>
                ) : null}

                {!checkoutDevolucionListo ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="checkout-cliente-nombre">Cliente</Label>
                    <Input
                      id="checkout-cliente-nombre"
                      type="text"
                      placeholder="Nombre en el ticket (opcional)"
                      value={checkoutClienteNombre}
                      onChange={(e) => setCheckoutClienteNombre(e.target.value)}
                      className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                    <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                      Solo para este ticket; no crea ni modifica clientes en el catálogo.
                    </p>
                  </div>
                ) : null}

                {checkoutDevolucionListo && puedeAcreditarDevolucion ? (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5">
                    <Label className="text-xs text-slate-600 dark:text-slate-400">
                      Forma de devolución al cliente
                    </Label>
                    <div className="flex flex-col gap-1.5 sm:flex-row">
                      <Button
                        type="button"
                        size="sm"
                        variant={devolucionAcreditarCuenta ? 'outline' : 'default'}
                        className="h-9 flex-1"
                        onClick={() => setDevolucionAcreditarCuenta(false)}
                      >
                        Efectivo / reembolso
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={devolucionAcreditarCuenta ? 'default' : 'outline'}
                        className="h-9 flex-1 bg-violet-600 text-white hover:bg-violet-500"
                        onClick={() => setDevolucionAcreditarCuenta(true)}
                      >
                        Acreditar a cuenta
                      </Button>
                    </div>
                  </div>
                ) : null}

                {checkoutDevolucionListo ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-center text-xs leading-relaxed text-black dark:text-slate-400 sm:text-sm">
                    {devolucionAcreditarCuenta && puedeAcreditarDevolucion ?
                      previewDevolucion?.kind === 'partial' ?
                        <>
                          Al confirmar, se registrará la devolución parcial: el inventario se reintegrará, el ticket se
                          actualizará y el importe se acreditará como crédito de tienda al cliente (sin entregar
                          efectivo).
                        </>
                      : <>
                          Al confirmar, el ticket quedará cancelado por devolución, el inventario se restaurará y el
                          importe se acreditará como crédito de tienda al cliente (sin entregar efectivo).
                        </>
                    : previewDevolucion?.kind === 'partial' ?
                      <>
                        Al confirmar, se registrará la devolución de las líneas elegidas: el inventario se
                        reintegrará, el ticket se actualizará y los cobros se ajustarán al nuevo total. Entregue al
                        cliente el reembolso indicado.
                      </>
                    : <>
                        Al confirmar, el ticket original quedará como cancelado por devolución, el inventario se
                        restaurará y el importe dejará de contar en totales del día. Entregue al cliente el dinero
                        (o aplique su política de reembolso).
                      </>
                    }
                  </p>
                ) : null}

                {!cobroTarjetaPue && !esTraspasoTienda && !checkoutDevolucionListo && formaPago !== 'PPC' ? (
                  <div className="space-y-2">
                    {metodoPago === 'PPD' ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-600 dark:text-slate-400">
                          Medio de este abono
                        </Label>
                        <Select
                          value={ppdAbonoFormaSelectValue}
                          onValueChange={(v) => {
                            setPpdAbonoFormaPago(v);
                          }}
                        >
                          <SelectTrigger className="h-10 w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent
                            align="start"
                            sideOffset={6}
                            hideScrollButtons
                            className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                          >
                            {ppdAbonoFormasEffective.map((fp) => (
                              <SelectItem
                                key={fp.clave}
                                value={fp.clave}
                                className="text-slate-900 dark:text-slate-100"
                              >
                                {fp.descripcion}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {creditoTiendaRestanteCheckout > 0.005 ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-9 w-full border border-violet-500/30 bg-violet-500/10 text-violet-800 hover:bg-violet-500/20 dark:text-violet-200"
                            onClick={aplicarCreditoTiendaDisponible}
                          >
                            Usar crédito ({formatMoney(creditoTiendaRestanteCheckout)})
                          </Button>
                        ) : null}
                        <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                          Parcialidades: registre cada cobro (varias tarjetas, efectivo + tarjeta, crédito de tienda, etc.).
                          Enter o Completar con un monto solo agrega ese abono y deja el diálogo abierto.
                          {puedeVentaConSaldoPendiente ?
                            ' Para cerrar dejando saldo en cuenta, vacíe el monto y pulse «Completar dejando saldo».'
                          : ' El total abonado debe cubrir el importe mostrado arriba.'}
                        </p>
                      </div>
                    ) : null}
                    <Label>Monto recibido</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={montoRecibidoInput}
                        onChange={(e) => setMontoRecibidoInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleProcessSale();
                          }
                        }}
                        className="h-12 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-center text-xl text-slate-900 dark:text-slate-100 sm:h-14 sm:text-2xl"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-12 shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-700 sm:h-14"
                        onClick={commitMontoRecibido}
                      >
                        Agregar
                      </Button>
                    </div>
                    {esFormaEfectivo(formaPagoAbono) ? (
                      <p className="text-center text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                        Escriba el monto y pulse Enter o <strong>Agregar</strong> para registrar el abono.
                        Si falta cobro, puede cambiar el medio (p. ej. a tarjeta) y seguir abonando.
                        {puedeVentaConSaldoPendiente ?
                          ' Solo con el monto vacío, «Completar dejando saldo» cierra e imprime con adeudo.'
                        : ' Cuando el total esté cubierto, pulse Completar venta.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {esFormaEfectivo(formaPagoAbono) &&
                !esTraspasoTienda &&
                !checkoutDevolucionListo &&
                formaPago !== 'PPC' ? (
                  <div className="flex flex-wrap gap-2">
                    {[50, 100, 200, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => addPago({ formaPago: formaPagoAbono, monto: amount })}
                        className="rounded-lg bg-slate-200 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-700"
                      >
                        {formatMoney(amount)}
                      </button>
                    ))}
                  </div>
                ) : null}

                {pagos.length > 0 &&
                !cobroTarjetaPue &&
                !checkoutDevolucionListo &&
                formaPago !== 'PPC' && (
                  <div className="space-y-2">
                    <Label>Pagos recibidos</Label>
                    <div className="space-y-2">
                      {pagos.map((pago, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded-lg bg-slate-200/80 dark:bg-slate-800/50 p-2.5 sm:p-3"
                        >
                          <span className="truncate pr-2 text-sm text-slate-700 dark:text-slate-300">
                            {labelFormaPago(pago.formaPago)}
                          </span>
                          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                            <span className="font-bold text-slate-800 dark:text-slate-200">{formatMoney(pago.monto)}</span>
                            <button
                              type="button"
                              onClick={() => removePago(index)}
                              className="text-red-400 hover:text-red-300"
                              aria-label="Quitar pago"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!esTraspasoTienda &&
                !checkoutDevolucionListo &&
                formaPago !== 'PPC' &&
                cambioVenta > 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 sm:p-4">
                    <p className="text-center text-emerald-400">
                      Cambio:{' '}
                      <span className="text-xl font-bold sm:text-2xl">{formatMoney(cambioVenta)}</span>
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCheckoutOpenChange(false)}
                  className="w-full border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 sm:w-auto"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleProcessSale()}
                  disabled={
                    processingSale ||
                    (checkoutDevolucionListo
                      ? false
                      : cobroTarjetaPue
                        ? false
                        : puedeVentaConSaldoPendiente
                          ? false
                          : totalPagadoIncluyeCampoMonto + 0.004 < cobroReferencia &&
                            !puedeRegistrarAbonoParcialMixto)
                  }
                  className="w-full bg-brand-gradient text-white sm:w-auto"
                >
                  {processingSale ? (
                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Check className="mr-2 h-5 w-5" />
                  )}
                  {checkoutDevolucionListo
                    ? 'Confirmar devolución'
                    : puedeVentaConSaldoPendiente &&
                        !hayCampoMontoParaAbonoValido &&
                        totalPagadoIncluyeCampoMonto + 0.004 < cobroReferencia
                      ? 'Completar dejando saldo'
                      : 'Completar venta'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-center text-lg sm:text-xl">
                  {ticketSnapshot?.modoDevolucion ? 'Devolución registrada' : '¡Venta completada!'}
                </DialogTitle>
              </DialogHeader>

              <div className="py-4 text-center sm:py-6">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 sm:mb-4 sm:h-20 sm:w-20">
                  <Check className="h-8 w-8 text-emerald-400 sm:h-10 sm:w-10" />
                </div>
                {ticketSnapshot?.modoDevolucion && ticketSnapshot.folioVentaOrigen ? (
                  <p className="mb-2 font-mono text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-base">
                    {ticketSnapshot.devolucionParcial ?
                      `Devolución parcial · ${ticketSnapshot.folioVentaOrigen}`
                    : `Ticket anulado ${ticketSnapshot.folioVentaOrigen}`}
                  </p>
                ) : ticketSnapshot?.folio ? (
                  <p className="mb-2 font-mono text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-base">
                    Folio {ticketSnapshot.folio}
                  </p>
                ) : null}
                <p className="mb-1 text-sm text-slate-600 dark:text-slate-400 sm:mb-2">
                  {ticketSnapshot?.modoDevolucion ? 'Monto devuelto al cliente' : 'Total'}
                </p>
                <p className="mb-3 text-3xl font-bold text-brand sm:mb-4 sm:text-4xl">
                  {formatMoney(ticketSnapshot?.total ?? 0)}
                </p>
                {ticketSnapshot?.modoDevolucion ? null : (
                  <p className="text-xs text-slate-600 dark:text-slate-500 sm:text-sm">
                    Cambio: {formatMoney(ticketSnapshot?.cambio ?? 0)}
                  </p>
                )}
                {!ticketSnapshot?.modoDevolucion &&
                ticketSnapshot?.adeudoPendiente != null &&
                ticketSnapshot.adeudoPendiente > 0.004 ? (
                  <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                    Saldo pendiente en cuenta: {formatMoney(ticketSnapshot.adeudoPendiente)}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={handlePrintTicket}
                  variant="outline"
                  className="flex-1 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
                <Button
                  onClick={handleFinishSale}
                  className="flex-1 bg-brand-gradient text-white"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Nueva venta
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showClientDialog} onOpenChange={setShowClientDialog}>
        <DialogContent className="flex min-h-0 w-full min-w-0 max-h-[92dvh] flex-col overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,40rem)] lg:max-w-[min(92vw,48rem)]">
          <DialogHeader>
            <DialogTitle>Cliente de la venta</DialogTitle>
          </DialogHeader>
          <div className="shrink-0 px-1 pb-2">
            <Input
              placeholder="Buscar nombre o RFC…"
              value={ventaClienteSearch}
              onChange={(e) => setVentaClienteSearch(e.target.value)}
              className="border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1 pb-2">
            <button
              type="button"
              onClick={() => {
                setClient(null);
                setShowClientDialog(false);
              }}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-200 dark:bg-slate-800/80 p-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-800"
            >
              <p className="font-medium text-slate-900 dark:text-slate-100">{POS_GENERIC_CLIENT_LABEL}</p>
              <p className="text-xs text-slate-600 dark:text-slate-500">Sin cliente registrado · lista Regular</p>
            </button>
            {clientesFiltradosVenta.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">
                Ningún cliente coincide. Registre clientes en Clientes o ajuste la búsqueda.
              </p>
            ) : (
              clientesFiltradosVenta.map((c) => {
                const listaId = normalizeClientPriceListIdWithExtras(
                  c.listaPreciosId,
                  useInventoryListsStore.getState().listasPrecioExtra
                );
                const listaLabel = priceListCatalog.labels[listaId] ?? listaId;
                return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClient(c);
                    setShowClientDialog(false);
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-200/80 dark:bg-slate-800/50 p-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-800"
                >
                  <p className="font-medium text-slate-800 dark:text-slate-200">{c.nombre}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-500">
                    Lista: {listaLabel}
                    {c.rfc ? ` · RFC: ${c.rfc}` : ''}
                  </p>
                </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mobileScannerOpen} onOpenChange={setMobileScannerOpen}>
        <DialogContent className="w-[min(calc(100vw-1.5rem),24rem)] border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 lg:hidden">
          <DialogHeader>
            <DialogTitle>Escanear producto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Apunte la cámara al código de barras del producto.
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-200/70 dark:border-slate-700 dark:bg-slate-800/60">
              <div id={mobileScannerElementIdRef.current} className="min-h-[16rem] w-full" />
            </div>
            {mobileScannerBusy ? (
              <p className="text-xs text-slate-600 dark:text-slate-400">Iniciando cámara…</p>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Al detectar un código válido, se agrega al carrito y la cámara se cierra.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={ventaResetConfirmOpen} onOpenChange={setVentaResetConfirmOpen}>
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {openSaleResume?.sale.estado === 'pendiente'
                ? '¿Cancelar esta venta abierta?'
                : '¿Reiniciar punto de venta?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              {openSaleResume?.sale.estado === 'pendiente' ? (
                <>
                  La venta{' '}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                    {openSaleResume.sale.folio}
                  </span>{' '}
                  quedará <strong>cancelada</strong>, se <strong>reintegrará el inventario</strong> y dejará de
                  mostrarse en la lista de pendientes.
                </>
              ) : (
                <>
                  Se vaciará el carrito, el cobro y la búsqueda. Es el mismo efecto que empezar de cero en esta
                  pantalla.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ventaResetBusy} className="border-slate-300 dark:border-slate-600">
              No
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={ventaResetBusy}
              className="bg-brand-from text-white hover:bg-brand-to"
              onClick={() => void confirmVentaReset()}
            >
              {ventaResetBusy
                ? 'Procesando…'
                : openSaleResume?.sale.estado === 'pendiente'
                  ? 'Sí, cancelar venta abierta'
                  : 'Sí, reiniciar'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={unitPriceDialogOpen}
        onOpenChange={(o) => {
          if (!o) closeUnitPriceDialog();
        }}
      >
        <DialogContent
          className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-lg"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || unitPriceEditStep !== 'price' || e.defaultPrevented) return;
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
            if (t.closest('[data-slot="select-content"]')) return;
            e.preventDefault();
            saveUnitPriceFromDialog();
          }}
        >
          <DialogHeader>
            <DialogTitle>Precio de la línea</DialogTitle>
            {unitPriceDialogLine ? (
              <p className="text-left text-sm font-normal text-slate-600 dark:text-slate-400">
                {unitPriceDialogLine.product.nombre}
              </p>
            ) : null}
          </DialogHeader>
          {unitPriceEditStep === 'pin' ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ingrese la contraseña de administrador para modificar el precio.
              </p>
              <Input
                ref={unitPricePinInputRef}
                type="password"
                autoComplete="off"
                placeholder="Contraseña"
                value={unitPricePinInput}
                onChange={(e) => setUnitPricePinInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmUnitPricePin();
                  }
                }}
                className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={closeUnitPriceDialog}>
                  Cancelar
                </Button>
                <Button type="button" onClick={confirmUnitPricePin}>
                  Continuar
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Toque una lista para aplicar el precio del catálogo solo a esta línea (sin cambiar la lista global del
                ticket). Use el importe de abajo para un precio manual; el IVA del artículo se usa para el cálculo
                interno.
              </p>

              {canEditCatalogListasDesdePos ? (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-200/40 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    disabled={!unitPriceEditProductId}
                    onClick={openListasPrecioCatalogDialog}
                  >
                    Modificar precios
                  </Button>
                  <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                    Edita los cinco precios por lista en el catálogo de este producto. Al confirmar se guardan en la
                    sucursal y el carrito muestra los importes nuevos.
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-300">Lista para esta línea</Label>
                <div className="flex flex-wrap gap-2">
                  {priceListCatalog.entries.map(({ id: lid, label }) => (
                    <Button
                      key={lid}
                      type="button"
                      size="sm"
                      variant={unitPriceLineListaActiva === lid ? 'default' : 'outline'}
                      className={cn(
                        'h-9 shrink-0 text-xs sm:text-sm',
                        unitPriceLineListaActiva === lid &&
                          'bg-brand-from text-white hover:bg-brand-to dark:bg-brand-from dark:hover:bg-brand-to'
                      )}
                      disabled={!unitPriceEditProductId}
                      onClick={() => {
                        if (!unitPriceEditProductId) return;
                        applyLinePrecioFromLista(unitPriceEditProductId, lid);
                        syncUnitPriceInputFromCartLine();
                        addToast({
                          type: 'success',
                          message: `Lista «${label}» aplicada a la línea`,
                        });
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {unitPriceDialogLine?.precioListaId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-slate-600 dark:text-slate-400"
                    disabled={!unitPriceEditProductId}
                    onClick={() => {
                      if (!unitPriceEditProductId) return;
                      resetLinePrecioToTicketLista(unitPriceEditProductId);
                      syncUnitPriceInputFromCartLine();
                      addToast({
                        type: 'success',
                        message: `Línea usa la lista del ticket (${priceListCatalog.labels[precioClienteListaId] ?? precioClienteListaId})`,
                      });
                    }}
                  >
                    Quitar lista propia — usar solo «{priceListCatalog.labels[precioClienteListaId] ?? precioClienteListaId}» del ticket
                  </Button>
                ) : null}
                {unitPriceLineIsManual ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Hay precio manual en esta línea; las listas anteriores lo sustituyen al tocarlas.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <Label>Precio manual (con IVA incluido)</Label>
                <Input
                  ref={unitPriceManualInputRef}
                  type="text"
                  inputMode="decimal"
                  value={unitPriceInput}
                  onChange={(e) => setUnitPriceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      saveUnitPriceFromDialog();
                    }
                  }}
                  className="border-slate-300 text-lg dark:border-slate-700 dark:bg-slate-800"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  «Guardar manual» fija el importe tecleado y quita la lista propia de la línea.
                </p>
              </div>

              <DialogFooter className="flex-col gap-2 border-t border-slate-200 pt-2 dark:border-slate-800 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={closeUnitPriceDialog}>
                  Cerrar
                </Button>
                <Button type="button" onClick={saveUnitPriceFromDialog}>
                  Guardar manual
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={listasPrecioCatalogDialogOpen}
        onOpenChange={(o) => {
          if (!o && !listasPrecioCatalogSaving) setListasPrecioCatalogDialogOpen(false);
        }}
      >
        <DialogContent
          overlayClassName="z-[200]"
          className="z-[201] max-h-[min(88dvh,calc(100dvh-4rem))] overflow-y-auto border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md"
          useDialogDescription
          onKeyDownCapture={(e) => {
            if (e.key !== 'Enter' || listasPrecioCatalogSaving) return;
            const t = e.target as HTMLElement;
            if (t.tagName === 'TEXTAREA' || t.isContentEditable) return;
            if (t.closest('[data-slot="select-content"]')) return;
            e.preventDefault();
            void saveListasPrecioCatalogFromPos();
          }}
        >
          <DialogHeader>
            <DialogTitle>Precios por lista en catálogo</DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              {unitPriceDialogLine?.product.nombre ?? 'Producto'}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Capture un importe por lista; deje vacío para quitar precio fijo y usar el % de configuración sobre el
            precio de venta. Cada lista se edita por separado; para recalcular todas, cambie el precio de venta en
            Inventario.{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {listasPrecioCatalogEditConIva
                ? `Los campos muestran precios con IVA (${unitPriceDialogLine?.product?.impuesto ?? 16}%).`
                : 'Los campos muestran precios sin IVA.'}{' '}
              {unitPriceDialogLine?.product ? (
                <>
                  En catálogo se guardan{' '}
                  {effectiveListaPreciosIncluyenIva(unitPriceDialogLine.product)
                    ? 'con IVA incluido'
                    : 'sin IVA'}
                  ; al confirmar se convierten si hace falta.
                </>
              ) : null}
            </span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            disabled={
              listasPrecioCatalogSaving || unitPriceDialogLine?.product == null
            }
            onClick={toggleListasPrecioCatalogEditConIva}
          >
            {listasPrecioCatalogEditConIva
              ? 'Cambiar a captura sin IVA'
              : 'Cambiar a captura con IVA'}
          </Button>
          <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            Al cambiar de modo se recalculan los importes ya escritos usando el IVA del artículo (
            {unitPriceDialogLine?.product?.impuesto ?? 16}%).
          </p>
          <div className="mb-4 space-y-3 rounded-lg border border-brand/25 bg-brand/10 p-3 dark:border-brand/30 dark:bg-brand/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-to dark:text-brand">
              Precio de compra (sin IVA)
            </p>
            <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {unitPriceDialogLine?.product != null &&
              unitPriceDialogLine.product.precioCompra != null &&
              Number.isFinite(Number(unitPriceDialogLine.product.precioCompra))
                ? formatMoney(Number(unitPriceDialogLine.product.precioCompra))
                : '—'}
            </p>
            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-500 [text-wrap:pretty]">
              Costo unitario que a usted le cuesta el producto: el valor guardado en catálogo como compra,{' '}
              <span className="font-medium">sin IVA</span>. El{' '}
              {unitPriceDialogLine?.product?.impuesto ?? 16}% de IVA del artículo aplica a la venta al público, no a este
              costo. Actualícelo al editar el producto en Inventario o al registrar entradas con precio de compra.
            </p>
          </div>
          <div className="space-y-3">
            {priceListCatalog.entries.map(({ id: lid, label }) => (
              <div key={lid} className="space-y-1">
                <Label className="text-slate-700 dark:text-slate-300">{label}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={listasPrecioStr[lid] ?? ''}
                  onChange={(e) =>
                    setListasPrecioStr((prev) => applyListaPrecioCatalogStrChange(prev, lid, e.target.value))
                  }
                  placeholder="—"
                  className="border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 border-t border-slate-200 pt-2 dark:border-slate-800 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={listasPrecioCatalogSaving}
              onClick={() => setListasPrecioCatalogDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={listasPrecioCatalogSaving} onClick={() => void saveListasPrecioCatalogFromPos()}>
              {listasPrecioCatalogSaving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ubicacionDialogProduct != null}
        onOpenChange={(open) => {
          if (!open) setUbicacionDialogProduct(null);
        }}
      >
        <DialogContent
          useDialogDescription
          className="z-[221] border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md"
          overlayClassName="z-[220]"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6 text-left text-base font-semibold leading-snug">
              <MapPin className="h-5 w-5 shrink-0 text-brand dark:text-brand" aria-hidden />
              <span className="min-w-0 break-words">{ubicacionDialogProduct?.nombre ?? 'Ubicación'}</span>
            </DialogTitle>
            <DialogDescription className="text-left text-slate-600 dark:text-slate-400">
              Ubicación física
            </DialogDescription>
          </DialogHeader>
          {ubicacionDialogProduct ? <UbicacionFisicaContent product={ubicacionDialogProduct} /> : null}
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

      <Dialog
        open={productDescriptionDialog != null}
        onOpenChange={(open) => {
          if (!open) {
            setProductDescriptionDialog(null);
            setProductDescriptionSaving(false);
          }
        }}
      >
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 text-left text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
              {productDescriptionDialog?.nombre ?? 'Producto'}
            </DialogTitle>
            <DialogDescription className="text-left text-xs text-slate-600 dark:text-slate-400">
              {canEditCatalogListasDesdePos
                ? 'Edite la descripción del artículo y guarde; se actualiza el catálogo de esta sucursal.'
                : 'Solo lectura. Se requiere permiso de edición de inventario para guardar cambios en el catálogo.'}
            </DialogDescription>
          </DialogHeader>
          {productDescriptionDialog ? (
            <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-950/50">
              <UbicacionFisicaContent product={productDescriptionDialog} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="pos-product-descripcion" className="text-slate-700 dark:text-slate-300">
              Descripción
            </Label>
            <textarea
              id="pos-product-descripcion"
              value={productDescriptionEditText}
              onChange={(e) => setProductDescriptionEditText(e.target.value)}
              readOnly={!canEditCatalogListasDesdePos}
              rows={8}
              placeholder="Sin descripción. Escriba detalles del artículo para el equipo y el ticket."
              className={cn(
                'w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed outline-none',
                'border-slate-200/80 bg-white/90 text-slate-800 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200',
                'min-h-[10rem] max-h-[min(50vh,22rem)]',
                'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25',
                !canEditCatalogListasDesdePos && 'cursor-not-allowed opacity-80'
              )}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setProductDescriptionDialog(null)}>
              Cerrar
            </Button>
            {canEditCatalogListasDesdePos ? (
              <Button
                type="button"
                disabled={productDescriptionSaving}
                onClick={() => void saveProductDescriptionFromPos()}
              >
                {productDescriptionSaving ? 'Guardando…' : 'Guardar'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
