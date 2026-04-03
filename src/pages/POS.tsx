import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
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
import { useCartStore, useAppStore, useAuthStore } from '@/stores';
import { setCajaPosHeaderBridge, clearCajaPosHeaderBridge } from '@/stores/cajaPosHeaderStore';
import {
  setVentasAbiertasPosHeaderBridge,
  clearVentasAbiertasPosHeaderBridge,
} from '@/stores/ventasAbiertasPosHeaderStore';
import { useProductSearch, useSales, useClients, useEffectiveSucursalId, useCajaSesion } from '@/hooks';
import { CajaPosToolbar, type CajaPosToolbarHandle } from '@/components/caja/CajaPosToolbar';
import type { Client, Product, FormaPago, Payment, Sale, Sucursal, CartItem } from '@/types';
import { FORMAS_PAGO_UI } from '@/types';
import {
  getSaleByFolio,
  getSaleById,
  getClientById,
  getProductById,
  findQuotationByLast4Folio,
  markQuotationConvertedWithSale,
  updatePendingOpenSale,
} from '@/db/database';
import { getSaleByIdFirestore } from '@/lib/firestore/salesFirestore';
import { getProductCatalogSnapshot } from '@/lib/firestore/productsFirestore';
import {
  buildPendingSaleLineItemsFromCart,
  clientFromSaleForPos,
  parseResumeListaPreciosId,
} from '@/lib/posOpenSaleResume';
import { clientFromQuotationForPos } from '@/lib/posQuotationCart';
import {
  CLIENT_PRICE_LIST_ORDER,
  CLIENT_PRICE_LABELS,
  type ClientPriceListId,
  POS_EDIT_UNIT_PRICE_PIN,
} from '@/lib/clientPriceLists';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { printThermalTicket } from '@/lib/printTicket';
import { getCartLineUnitSinIvaBase, getProductUnitSinIvaForClienteList } from '@/lib/productListPricing';

// ============================================
// PUNTO DE VENTA (POS) — Vista tipo app: lg+ sin scroll del contenedor (solo carrito / panel cobro); móvil conserva scroll vertical.
// ============================================

function cartLineUnitSinIva(item: CartItem, listaId: ClientPriceListId): number {
  const u = getCartLineUnitSinIvaBase(item, listaId);
  return u * (1 - (Number(item.discount) || 0) / 100);
}

function cartLineTotalConIva(item: CartItem, listaId: ClientPriceListId): number {
  const imp = Number(item.product.impuesto) || 16;
  return cartLineUnitSinIva(item, listaId) * item.quantity * (1 + imp / 100);
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
};

export function POS() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { addSale, sales: salesCatalog, completePendingSale, cancelSale: ejecutarCancelacionVenta } =
    useSales(500);
  const { effectiveSucursalId } = useEffectiveSucursalId();
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
      retiroEfectivoVisible: Boolean(cajaSesion.activa),
      onRetiroEfectivo: () => cajaToolbarRef.current?.openRetiroEfectivoDialog(),
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
    getTotalPagado,
    getCambio,
  } = cart;

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
    if (openSaleResume) {
      return formasPagoPos.filter(
        (fp) =>
          fp.clave !== 'DEV' && fp.clave !== 'TTS' && fp.clave !== 'COT' && fp.clave !== 'PPC'
      );
    }
    return formasPagoPos;
  }, [formasPagoPos, openSaleResume]);

  const formaPagoSelectValue = useMemo(() => {
    if (formasPagoPosEffective.some((fp) => fp.clave === formaPago)) return formaPago;
    return formasPagoPosEffective[0]?.clave ?? '01';
  }, [formasPagoPosEffective, formaPago]);

  const metodoPagoSelectValue: 'PUE' | 'PPD' = metodoPago === 'PPD' ? 'PPD' : 'PUE';

  const precioClienteListaSelectValue = useMemo((): ClientPriceListId => {
    const id = precioClienteListaId;
    if ((CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(id)) return id;
    return 'regular';
  }, [precioClienteListaId]);

  const [devolucionFolioInput, setDevolucionFolioInput] = useState('');
  const [devolucionSaleResuelta, setDevolucionSaleResuelta] = useState<Sale | null>(null);
  const [devolucionBusy, setDevolucionBusy] = useState(false);
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
    } else {
      setOpenSaleResume(null);
      setSaleFromQuotationId(null);
      setQuotationLoadedFolio(null);
      setCotizacionUltimos4('');
    }
  }, [esFormaDevolucion]);

  useEffect(() => {
    if (esFormaCotizacion) {
      setOpenSaleResume(null);
      setDevolucionFolioInput('');
      setDevolucionSaleResuelta(null);
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

  /** PPD + cliente registrado: permite cobrar menos del total (saldo en cuenta del cliente). */
  const puedeVentaConSaldoPendiente =
    !esTraspasoTienda &&
    metodoPago === 'PPD' &&
    Boolean(client?.id && client.id !== 'mostrador' && !client.isMostrador);

  const labelFormaPago = (clave: string) =>
    formasPagoPos.find((fp) => fp.clave === clave)?.descripcion ?? clave;

  const [searchQuery, setSearchQuery] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>('payment');
  const [ticketSnapshot, setTicketSnapshot] = useState<PosTicketSnapshot | null>(null);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [montoRecibidoInput, setMontoRecibidoInput] = useState('');
  /** Últimos 4 dígitos del voucher para el siguiente abono con tarjeta (04/28). */
  const [tarjetaUltimos4, setTarjetaUltimos4] = useState('');
  /** En parcialidades (PPD), medio del próximo abono (mezcla efectivo + tarjetas sin cambiar el selector lateral). */
  const [ppdAbonoFormaPago, setPpdAbonoFormaPago] = useState('01');
  /** Se incrementa al abrir el diálogo de cobro para inicializar `ppdAbonoFormaPago` sin pisar cambios al mover el selector lateral. */
  const [checkoutPaymentKey, setCheckoutPaymentKey] = useState(0);
  const [processingSale, setProcessingSale] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('cart');
  const [globalDiscFocus, setGlobalDiscFocus] = useState(false);
  /** Fila del carrito cuyo % descuento está enfocado (vacío visual si es 0, como desc. global). */
  const [lineDiscountFocusProductId, setLineDiscountFocusProductId] = useState<string | null>(null);
  const [ventaResetConfirmOpen, setVentaResetConfirmOpen] = useState(false);
  const [ventaResetBusy, setVentaResetBusy] = useState(false);
  const [unitPriceDialogOpen, setUnitPriceDialogOpen] = useState(false);
  const [unitPriceEditProductId, setUnitPriceEditProductId] = useState<string | null>(null);
  const [unitPriceEditStep, setUnitPriceEditStep] = useState<'pin' | 'price'>('pin');
  const [unitPricePinInput, setUnitPricePinInput] = useState('');
  const [unitPriceInput, setUnitPriceInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productSearchWrapRef = useRef<HTMLDivElement>(null);

  const { results: searchResults, search: searchProducts } = useProductSearch();
  const { clients, refresh: refreshClients } = useClients();

  const clientesFiltradosParaCxc = useMemo(() => {
    const q = pasarCxcClienteSearch.trim().toLowerCase();
    return clients.filter((c) => {
      if (c.isMostrador || c.id === 'mostrador') return false;
      if (!q) return true;
      return (
        c.nombre.toLowerCase().includes(q) ||
        (c.rfc?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [clients, pasarCxcClienteSearch]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery) {
        searchProducts(searchQuery);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, searchProducts]);

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

  useEffect(() => {
    if (!showProductSearch) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = productSearchWrapRef.current;
      if (!root?.contains(e.target as Node)) {
        setShowProductSearch(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showProductSearch]);

  const handleCheckoutOpenChange = (open: boolean) => {
    setCheckoutOpen(open);
    if (!open) {
      setCheckoutPhase('payment');
      setTicketSnapshot(null);
      setMobileTab('cart');
    }
  };

  /** Reinicia carrito, cobro, búsqueda y devolución como al entrar al POS. */
  const resetPuntoVenta = useCallback(() => {
    handleCheckoutOpenChange(false);
    setOpenSaleResume(null);
    setSaleFromQuotationId(null);
    setQuotationLoadedFolio(null);
    setCotizacionUltimos4('');
    clearCart();
    setSearchQuery('');
    setShowProductSearch(false);
    setShowClientDialog(false);
    setMontoRecibidoInput('');
    setTarjetaUltimos4('');
    setProcessingSale(false);
    setGlobalDiscFocus(false);
    setLineDiscountFocusProductId(null);
    setDevolucionFolioInput('');
    setDevolucionSaleResuelta(null);
    setDevolucionBusy(false);
    setVentaResetConfirmOpen(false);
    searchInputRef.current?.blur();
  }, [clearCart]);

  const confirmVentaReset = useCallback(async () => {
    const resumed = openSaleResume;
    if (resumed?.sale.estado === 'pendiente') {
      setVentaResetBusy(true);
      try {
        await ejecutarCancelacionVenta(resumed.sale.id, {
          motivo: 'Venta abierta anulada desde el punto de venta',
        });
        addToast({
          type: 'success',
          message: `Venta ${resumed.sale.folio} cancelada; el inventario se reintegró y ya no aparece en pendientes.`,
          logToAppEvents: true,
        });
        resetPuntoVenta();
      } catch (e: unknown) {
        addToast({
          type: 'error',
          message: e instanceof Error ? e.message : 'No se pudo cancelar la venta abierta',
          logToAppEvents: true,
        });
      } finally {
        setVentaResetBusy(false);
      }
      return;
    }
    resetPuntoVenta();
  }, [openSaleResume, ejecutarCancelacionVenta, addToast, resetPuntoVenta]);

  const openUnitPriceDialog = (productId: string) => {
    const it = items.find((i) => i.product.id === productId);
    if (!it) return;
    setUnitPriceEditProductId(productId);
    setUnitPriceEditStep(isAdmin ? 'price' : 'pin');
    setUnitPricePinInput('');
    const baseSinIva = Number(it.precioUnitarioOverride ?? it.product.precioVenta) || 0;
    const conIva = unitBaseSinIvaToPrecioConIva(baseSinIva, it.product.impuesto);
    setUnitPriceInput(conIva.toFixed(2));
    setUnitPriceDialogOpen(true);
  };

  const closeUnitPriceDialog = () => {
    setUnitPriceDialogOpen(false);
    setUnitPriceEditProductId(null);
    setUnitPriceEditStep('pin');
    setUnitPricePinInput('');
    setUnitPriceInput('');
  };

  const confirmUnitPricePin = () => {
    if (unitPricePinInput.trim() === POS_EDIT_UNIT_PRICE_PIN) {
      setUnitPriceEditStep('price');
      setUnitPricePinInput('');
      return;
    }
    addToast({ type: 'error', message: 'Contraseña incorrecta' });
  };

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
    addToast({ type: 'success', message: 'Precio unitario actualizado', logToAppEvents: true });
    closeUnitPriceDialog();
  };

  const openCheckoutDialog = () => {
    setCheckoutPhase('payment');
    setCheckoutOpen(true);
    setCheckoutPaymentKey((k) => k + 1);
  };

  useEffect(() => {
    if (checkoutOpen && checkoutPhase === 'payment') {
      setMontoRecibidoInput('');
      setTarjetaUltimos4('');
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

  const ppdAbonoFormaSelectValue = useMemo(() => {
    if (FORMAS_PAGO_UI.some((f) => f.clave === ppdAbonoFormaPago)) return ppdAbonoFormaPago;
    return '01';
  }, [ppdAbonoFormaPago]);

  const esFormaTarjeta = (fp: string) => fp === '04' || fp === '28';
  const esFormaEfectivo = (fp: string) => fp === '01';

  /** Forma aplicada al siguiente abono manual (en PPD la elige el diálogo). */
  const formaPagoAbono = metodoPago === 'PPD' ? ppdAbonoFormaPago : formaPago;

  /** Tarjeta en una sola exhibición: solo voucher (4 dígitos), sin capturar monto ni billetes. */
  const cobroTarjetaPue =
    !esTraspasoTienda && esFormaTarjeta(formaPago) && metodoPago === 'PUE';

  const digitos4TarjetaPendiente = () => tarjetaUltimos4.replace(/\D/g, '').slice(0, 4);

  const toastTarjeta4Requeridos = () =>
    addToast({
      type: 'warning',
      message: 'Ingrese los últimos 4 dígitos de la tarjeta (aparecen en el voucher del terminal)',
    });

  useEffect(() => {
    if (!checkoutOpen || checkoutPhase !== 'payment' || !esTraspasoTienda) return;
    if (pagos.length === 0) {
      addPago({ formaPago: 'TTS', monto: 0 });
    }
  }, [checkoutOpen, checkoutPhase, esTraspasoTienda, pagos.length, addPago]);

  const commitMontoRecibido = () => {
    const normalized = montoRecibidoInput.replace(',', '.').trim();
    const monto = parseFloat(normalized) || 0;
    if (monto <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto mayor a cero' });
      return;
    }
    if (esFormaTarjeta(formaPagoAbono)) {
      const d4 = digitos4TarjetaPendiente();
      if (d4.length !== 4) {
        toastTarjeta4Requeridos();
        return;
      }
      addPago({ formaPago: formaPagoAbono, monto, referencia: d4 });
      setTarjetaUltimos4('');
    } else {
      addPago({ formaPago: formaPagoAbono, monto });
    }
    setMontoRecibidoInput('');
  };

  const handleAddProduct = (product: Product) => {
    try {
      addItem(product, 1);
      setSearchQuery('');
      setShowProductSearch(false);
      addToast({ type: 'success', message: `${product.nombre} agregado` });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Error al agregar',
      });
    }
  };

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
        productos: items.map((item) => {
          const unitBase = getCartLineUnitSinIvaBase(item, precioClienteListaId);
          const sub = unitBase * item.quantity * (1 - item.discount / 100);
          return {
            id: crypto.randomUUID(),
            productId: item.product.id,
            productoNombre: item.product.nombre?.trim() || undefined,
            cantidad: item.quantity,
            precioUnitario: unitBase,
            descuento: item.discount,
            impuesto: item.product.impuesto,
            subtotal: sub,
            total: sub * (1 + item.product.impuesto / 100),
          };
        }),
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
      clearCart();
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
        const product = await resolveProductForResume(line.productId);
        if (!product) {
          addToast({
            type: 'error',
            message: `No se encontró el producto en catálogo (ID ${line.productId.slice(0, 8)}…).`,
          });
          return;
        }
        cartItems.push({
          product,
          quantity: line.cantidad,
          discount: line.descuento,
          precioUnitarioOverride: line.precioUnitario,
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
        message: `Venta ${sale.folio} cargada. Registre el cobro y pulse Cobrar.`,
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

  useEffect(() => {
    const st = location.state as {
      posPreselectClienteId?: string;
      posAbrirVentaId?: string;
    } | null | undefined;
    const ventaId = st?.posAbrirVentaId?.trim();
    const cid = st?.posPreselectClienteId?.trim();
    if (!ventaId && (!cid || cid === 'mostrador')) return;

    navigate('.', { replace: true, state: null });

    void (async () => {
      try {
        if (ventaId) {
          let sale: Sale | undefined = salesCatalog.find((s) => s.id === ventaId);
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
            message: 'No hay cliente registrado en este ticket para abrirlo en el POS.',
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
  }, [location.state, navigate, salesCatalog, effectiveSucursalId, setClient, addToast, setMobileTab]);

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
    clearCart();
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
        const product = await resolveProductForResume(line.productId);
        if (!product) {
          addToast({
            type: 'error',
            message: `No se encontró el producto en catálogo (ID ${line.productId.slice(0, 8)}…).`,
          });
          return;
        }
        cartItems.push({
          product,
          quantity: line.cantidad,
          discount: line.descuento,
          precioUnitarioOverride: line.precioUnitario,
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
        precioClienteListaId: clientePos?.listaPreciosId ?? 'regular',
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
    clearCart();
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
      setProcessingSale(true);
      try {
        await ejecutarCancelacionVenta(devolucionSaleResuelta.id, {
          motivo: 'Devolución en punto de venta',
          cancelacionMotivo: 'devolucion',
        });
        const monto = Number(devolucionSaleResuelta.total) || 0;
        const lineas = (devolucionSaleResuelta.productos ?? []).map((it) => {
          const desc =
            it.producto?.nombre?.trim() ||
            it.productoNombre?.trim() ||
            `Artículo (${String(it.productId).slice(0, 8)}…)`;
          const disc = Number(it.descuento) || 0;
          const pu = Number(it.precioUnitario) || 0;
          const unit = pu * (1 - disc / 100);
          const qty = Number(it.cantidad) || 0;
          const lineTot =
            it.subtotal != null && Number.isFinite(Number(it.subtotal)) ? Number(it.subtotal) : qty * pu;
          return { descripcion: desc, cantidad: qty, precioUnit: unit, total: lineTot };
        });
        const cajeroNombre =
          user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
        setTicketSnapshot({
          clienteNombre: devolucionSaleResuelta.cliente?.nombre?.trim() || 'Mostrador',
          cajeroNombre,
          lineas,
          subtotal: Number(devolucionSaleResuelta.subtotal) || 0,
          impuestos: Number(devolucionSaleResuelta.impuestos) || 0,
          total: monto,
          cambio: 0,
          sucursalId: effectiveSucursalId,
          folio: undefined,
          modoDevolucion: true,
          folioVentaOrigen: devolucionSaleResuelta.folio,
          notas:
            'DEVOLUCIÓN: Entregue al cliente el importe indicado. El ticket original quedó cancelado por devolución.',
          resumenPagos: [{ label: 'Reembolso (devolución)', monto }],
        });
        setDevolucionFolioInput('');
        setDevolucionSaleResuelta(null);
        setFormaPago('01');
        clearCart();
        setCheckoutPhase('success');
        addToast({
          type: 'success',
          message: `Devolución registrada. Reembolso al cliente: ${formatMoney(monto)}`,
          logToAppEvents: true,
        });
      } catch (error: unknown) {
        addToast({
          type: 'error',
          message: error instanceof Error ? error.message : 'Error al procesar la devolución',
          logToAppEvents: true,
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

    const cobroTarjetaPueLocal =
      !esTraspasoTienda && esFormaTarjeta(formaPago) && metodoPago === 'PUE';

    if (formaPago !== 'PPC' && !esTraspasoTienda && !cobroTarjetaPueLocal) {
      if (metodoPago === 'PPD') {
        const fpLinea = ppdAbonoFormaPago;
        const norm = montoRecibidoInput.replace(',', '.').trim();
        if (norm) {
          const m = parseFloat(norm);
          if (Number.isFinite(m) && m > 0) {
            if (esFormaTarjeta(fpLinea)) {
              const d4 = digitos4TarjetaPendiente();
              if (d4.length === 4) {
                addPago({ formaPago: fpLinea, monto: m, referencia: d4 });
                setMontoRecibidoInput('');
                setTarjetaUltimos4('');
              }
            } else {
              addPago({ formaPago: fpLinea, monto: m });
              setMontoRecibidoInput('');
            }
          }
        }
      } else if (esFormaEfectivo(formaPago)) {
        const norm = montoRecibidoInput.replace(',', '.').trim();
        if (norm) {
          const m = parseFloat(norm);
          if (Number.isFinite(m) && m > 0) {
            addPago({ formaPago, monto: m });
            setMontoRecibidoInput('');
          }
        }
      }
    }

    if (items.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos al carrito' });
      return;
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

    let pagosParaVenta = formaPago === 'PPC' ? [] : pagos;

    if (cobroTarjetaPueLocal) {
      const d4 = digitos4TarjetaPendiente();
      if (d4.length !== 4) {
        addToast({
          type: 'warning',
          message: 'Ingrese los 4 dígitos del voucher para cobrar con tarjeta.',
        });
        return;
      }
      pagosParaVenta = [{ formaPago, monto: totalCobro, referencia: d4 }];
    } else if (!esTraspasoTienda) {
      const permiteDeuda = puedeVentaConSaldoPendiente || formaPago === 'PPC';
      if (!permiteDeuda && getTotalPagado() < totalCobro) {
        addToast({ type: 'error', message: 'El pago es insuficiente' });
        return;
      }
    }

    if (!esTraspasoTienda && formaPago !== 'PPC') {
      for (const p of pagosParaVenta) {
        if (esFormaTarjeta(p.formaPago)) {
          const ref = p.referencia?.trim() ?? '';
          if (!/^\d{4}$/.test(ref)) {
            addToast({
              type: 'error',
              message:
                'Cada pago con tarjeta debe incluir los 4 dígitos del voucher. Quite el abono y vuelva a agregarlo.',
            });
            return;
          }
        }
      }
    }

    const sumPagosCobro = esTraspasoTienda
      ? 0
      : pagosParaVenta.reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const adeudoTicket = esTraspasoTienda
      ? 0
      : Math.max(0, Math.round((totalCobro - sumPagosCobro) * 100) / 100);

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

    setProcessingSale(true);

    try {
      const cajeroNombre =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;

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
        const cambioAbierta = cobroTarjetaPueLocal ? 0 : getCambio();
        const pagosCompletacion: Payment[] = pagosParaVenta.map((p) => ({
          id: crypto.randomUUID(),
          formaPago: p.formaPago as FormaPago,
          monto: p.monto,
          referencia: p.referencia,
        }));
        await completePendingSale(pend.id, {
          formaPago: formaPago as FormaPago,
          metodoPago: metodoPago as 'PUE' | 'PPD',
          pagos: pagosCompletacion,
          cambio: cambioAbierta,
          usuarioNombreCierre: cajeroNombre,
          cajaSesionId: cajaSesion.activa?.id,
          clienteId: client?.id ?? 'mostrador',
          cliente: client ?? null,
        });

        const clienteNombre = client?.nombre || pend.cliente?.nombre?.trim() || 'Mostrador';
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
              ultimos4:
                esFormaTarjeta(p.formaPago) && /^\d{4}$/.test(p.referencia?.trim() ?? '')
                  ? p.referencia!.trim()
                  : undefined,
            }));
        setTicketSnapshot({
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
        });
        setOpenSaleResume(null);
        clearCart();
        setCheckoutPhase('success');
        addToast({
          type: 'success',
          message:
            adeudoTicket > 0.005
              ? `Cobro registrado. Saldo pendiente del cliente: ${formatMoney(adeudoTicket)} (ver Cuentas por cobrar).`
              : 'Cobro registrado. Venta completada.',
          logToAppEvents: true,
        });
        return;
      }

      const cambioVentaFinal = esTraspasoTienda ? 0 : cobroTarjetaPueLocal ? 0 : getCambio();

      const destNombre =
        sucursalesCat.find((s) => s.id === transferenciaDestinoSucursalId)?.nombre ??
        transferenciaDestinoSucursalId;
      const saleData = {
        clienteId: client?.id || 'mostrador',
        /** Snapshot para ticket / reimpresión (solo `clienteId` dejaba el UUID en el ticket). */
        ...(client ? { cliente: client } : {}),
        productos: items.map((item) => {
          const unitBase = getCartLineUnitSinIvaBase(item, precioClienteListaId);
          const sub =
            unitBase * item.quantity * (1 - item.discount / 100);
          return {
            id: crypto.randomUUID(),
            productId: item.product.id,
            productoNombre: item.product.nombre?.trim() || undefined,
            cantidad: item.quantity,
            precioUnitario: unitBase,
            descuento: item.discount,
            impuesto: item.product.impuesto,
            subtotal: sub,
            total: sub * (1 + item.product.impuesto / 100),
          };
        }),
        subtotal: subtotalCobro,
        descuento: descuentoCobro,
        impuestos: impuestosCobro,
        total: totalCobro,
        formaPago: formaPago as FormaPago,
        metodoPago: metodoPago as 'PUE' | 'PPD',
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
          await markQuotationConvertedWithSale(saleFromQuotationId, ventaIdNueva);
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

      const clienteNombre = client?.nombre || 'Mostrador';
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
              ultimos4:
                esFormaTarjeta(p.formaPago) && /^\d{4}$/.test(p.referencia?.trim() ?? '')
                  ? p.referencia!.trim()
                  : undefined,
            }))
          : undefined;

      setTicketSnapshot({
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
      });
      clearCart();
      // Mismo portal de diálogo: pasar a "success" evita dos Dialog de Radix a la vez (insertBefore/removeChild).
      setCheckoutPhase('success');

      addToast({
        type: 'success',
        message:
          adeudoTicket > 0.005
            ? `Venta completada. Saldo a cuenta del cliente: ${formatMoney(adeudoTicket)}. Consulte Cuentas por cobrar.`
            : 'Venta completada exitosamente',
        logToAppEvents: true,
      });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Error al procesar la venta',
        logToAppEvents: true,
      });
    } finally {
      setProcessingSale(false);
    }
  };

  const handleFinishSale = () => {
    handleCheckoutOpenChange(false);
  };

  const handlePrintTicket = () => {
    const snap = ticketSnapshot;
    if (!snap) return;
    if (snap.modoDevolucion) {
      printThermalTicket({
        negocio: 'SERVIPARTZ POS',
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
      });
      return;
    }
    printThermalTicket({
      negocio: 'SERVIPARTZ POS',
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
    });
  };

  const checkoutDevolucionListo =
    checkoutOpen &&
    checkoutPhase === 'payment' &&
    formaPago === 'DEV' &&
    devolucionSaleResuelta?.estado === 'completada';

  const montoDialogoPrincipal = checkoutDevolucionListo
    ? Number(devolucionSaleResuelta?.total) || 0
    : totalCobro;

  const panelClass =
    'rounded-xl border border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 shadow-sm';

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
            <p className="text-xs leading-snug text-amber-950 dark:text-amber-100 sm:text-sm">
              Retomando venta abierta{' '}
              <span className="font-mono font-semibold">{openSaleResume.sale.folio}</span>. Puede editar líneas; los
              cambios se guardan al poco tiempo. Registre el pago y pulse Cobrar.
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
              ? 'bg-cyan-500/15 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-300'
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
              ? 'bg-cyan-500/15 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-300'
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
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowProductSearch(true)}
                placeholder="Buscar (F2) · SKU, código, nombre"
                className="h-10 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 pl-9 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 sm:h-11 sm:pl-10 md:text-sm"
              />

              {showProductSearch && searchResults.length > 0 && (
                <div
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(42dvh,16rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xl sm:mt-2"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {searchResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleAddProduct(product)}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/50 p-2.5 text-left transition-colors last:border-0 hover:bg-slate-200/80 dark:bg-slate-800/50 sm:p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800 dark:text-slate-200">{product.nombre}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-500">SKU: {product.sku}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold text-cyan-400">
                          {formatMoney(getProductUnitSinIvaForClienteList(product, precioClienteListaId))}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">sin IVA</p>
                        <p
                          className={cn(
                            'text-xs',
                            product.existencia <= product.existenciaMinima
                              ? 'text-amber-400'
                              : 'text-slate-600 dark:text-slate-500'
                          )}
                        >
                          Stk {product.existencia}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Card
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50'
            )}
          >
            <CardHeader className="shrink-0 space-y-0 border-b border-slate-200/80 dark:border-slate-800/50 py-2 sm:py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 sm:text-base">
                <ShoppingCart className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
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
                    {items.map((item) => (
                      <div
                        key={item.product.id}
                        className="grid gap-2 p-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3 sm:p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800 dark:text-slate-200">{item.product.nombre}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-500">SKU {item.product.sku}</p>
                          <p className="text-xs text-cyan-400/90 sm:text-sm">
                            {formatMoney(cartLineUnitSinIva(item, precioClienteListaId))} c/u{' '}
                            <span className="text-slate-500 dark:text-slate-400">sin IVA</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                          <div className="flex items-center gap-1">
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
                            <span className="w-8 text-center text-sm font-medium">
                              {item.quantity}
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
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Barra rápida móvil: total + ir a cobro */}
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800/60 bg-white/95 dark:bg-slate-950/90 p-2 lg:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-500">Total</p>
              <p className="truncate text-lg font-bold text-cyan-400">{formatMoney(totalCobro)}</p>
            </div>
            <Button
              type="button"
              disabled={items.length === 0}
              onClick={() => setMobileTab('checkout')}
              className="h-10 shrink-0 bg-gradient-to-r from-cyan-500 to-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
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
              'hover:border-cyan-500/40 hover:bg-slate-100/95 dark:hover:border-cyan-500/35 dark:hover:bg-slate-800/70',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40'
            )}
            onClick={() => {
              void refreshClients();
              setShowClientDialog(true);
            }}
            aria-label={`Cliente: ${client?.nombre || 'Mostrador'}. Cambiar cliente`}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 sm:h-10 sm:w-10 lg:h-8 lg:w-8">
                <User className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5 lg:h-4 lg:w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-500 sm:text-xs lg:text-[9px]">
                  Cliente
                </p>
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base lg:text-sm">
                  {client?.nombre || 'Mostrador'}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-cyan-700 sm:text-sm dark:text-cyan-400 lg:text-xs">
              Cambiar
            </span>
          </button>

          <div className="min-w-0 overflow-x-hidden overscroll-y-contain lg:flex-none lg:overflow-visible">
          <Card className="flex min-w-0 flex-col overflow-visible border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 max-lg:flex-none lg:shrink-0 lg:flex-none lg:overflow-visible">
            <CardContent className="flex flex-col gap-3 overflow-visible p-2 sm:p-3 lg:gap-2 lg:overflow-visible lg:p-2.5">
              <div className="shrink-0 space-y-2 lg:space-y-1">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm lg:gap-x-2 lg:gap-y-0.5 lg:text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(subtotalCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">Descuento</span>
                  <span className="text-right text-amber-400">-{formatMoney(descuentoCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">IVA 16%</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(impuestosCobro)}</span>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-2 lg:pt-1.5">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base lg:text-sm">
                      Total
                    </span>
                    <span className="text-xl font-bold tabular-nums text-cyan-400 sm:text-2xl lg:text-2xl">
                      {formatMoney(totalCobro)}
                    </span>
                  </div>
                </div>
                {puedeVentaConSaldoPendiente &&
                totalCobro > 0 &&
                totalPagadoVenta + 0.004 < totalCobro ? (
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 sm:text-xs">
                    En Cobrar podrá completar con saldo pendiente:{' '}
                    {formatMoney(Math.max(0, totalCobro - totalPagadoVenta))}
                  </p>
                ) : null}
                {esTraspasoTienda ? (
                  <p className="text-[10px] text-cyan-500/90 sm:text-xs">
                    Traspaso entre tiendas: cobro $0 (solo administrador). El stock se descuenta en esta
                    sucursal.
                  </p>
                ) : null}
                {esFormaDevolucion ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400/90 sm:text-xs">
                    Devolución: ingrese el folio del ticket, pulse Buscar, deje el carrito vacío y use Cobrar.
                  </p>
                ) : null}
                {esFormaCotizacion ? (
                  <p className="text-[10px] text-cyan-700 dark:text-cyan-400/90 sm:text-xs">
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
                          <span className="font-semibold text-cyan-600 dark:text-cyan-400">
                            {formatMoney(Number(devolucionSaleResuelta.total) || 0)}
                          </span>
                        </p>
                        {devolucionSaleResuelta.estado === 'completada' ? (
                          <p className="text-emerald-600 dark:text-emerald-400">Listo para devolver al cliente.</p>
                        ) : devolucionSaleResuelta.estado === 'cancelada' ? (
                          <p className="text-amber-600 dark:text-amber-400">
                            {devolucionSaleResuelta.cancelacionMotivo === 'devolucion' ?
                              'Ya cancelado por devolución.'
                            : 'Venta cancelada.'}
                          </p>
                        ) : (
                          <p className="text-amber-600 dark:text-amber-400">No aplica para devolución en POS.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {esFormaCotizacion ? (
                  <div className="space-y-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2.5 sm:p-3">
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
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-snug text-amber-950 dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-100 sm:text-xs">
                    <span className="font-semibold">Pendiente de pago:</span> se registrará el total como saldo del
                    cliente (aparece en Cuentas por cobrar con el folio del ticket). Elija un cliente registrado, no
                    Mostrador.
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
                {metodoPago === 'PPD' &&
                (!client || client.isMostrador || client.id === 'mostrador') &&
                !esTraspasoTienda &&
                !esFormaDevolucion &&
                !esFormaCotizacion &&
                !esFormaPendientePago ? (
                  <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400 sm:text-xs">
                    Para dejar saldo a cuenta elija un cliente registrado (no Mostrador).
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
                          {CLIENT_PRICE_LIST_ORDER.map((id) => (
                            <SelectItem key={id} value={id} className="text-slate-900 dark:text-slate-100">
                              {CLIENT_PRICE_LABELS[id]}
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
                  items.length > 0
                : esFormaCotizacion
                  ? true
                  : items.length === 0 ||
                    (formaPago === 'TTS' && isAdmin && !transferenciaDestinoSucursalId?.trim()) ||
                    (formaPago === 'PPC' &&
                      (!client || client.id === 'mostrador' || client.isMostrador))
              }
              className="h-11 w-full min-w-0 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-base font-bold text-white shadow-lg shadow-cyan-500/25 sm:h-12 md:h-14 md:text-lg"
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
              className="h-10 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-950 hover:bg-amber-500/20 dark:border-amber-500/35 dark:text-amber-100 dark:hover:bg-amber-500/15 sm:h-11 lg:h-9 lg:text-sm"
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
                «Pasar a cuentas por cobrar» en mostrador pedirá elegir el cliente deudor.
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
                        'flex w-full flex-col gap-0.5 rounded-xl border border-slate-200/90 bg-slate-200/60 px-3 py-2.5 text-left transition-colors hover:border-cyan-500/45 hover:bg-slate-200/90 dark:border-slate-700/90 dark:bg-slate-800/60 dark:hover:border-cyan-500/40 dark:hover:bg-slate-800/90',
                        filaBusy && 'pointer-events-none opacity-50'
                      )}
                    >
                      <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
                        {vs.folio}
                      </span>
                      <span className="truncate text-xs text-slate-600 dark:text-slate-400">
                        {vs.cliente?.nombre?.trim() || vs.clienteId || 'Cliente'}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-cyan-600 dark:text-cyan-400">
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
                  <Receipt className="h-5 w-5 text-cyan-400 sm:h-6 sm:w-6" />
                  {checkoutDevolucionListo ? 'Confirmar devolución' : formaPago === 'PPC' ? 'Pendiente de pago' : 'Procesar pago'}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-1 sm:space-y-4 sm:py-2">
                <div className="rounded-xl bg-slate-200/80 dark:bg-slate-800/50 p-3 text-center sm:p-4">
                  <p className="mb-1 text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
                    {checkoutDevolucionListo ? 'Total a devolver al cliente' : 'Total a pagar'}
                  </p>
                  <p className="text-2xl font-bold text-cyan-400 sm:text-4xl">
                    {formatMoney(montoDialogoPrincipal)}
                  </p>
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
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-center text-xs leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/35 dark:text-amber-100 sm:text-sm">
                    No se registrará cobro en caja. El importe total quedará como saldo del cliente y el ticket se
                    listará en <span className="font-semibold">Cuentas por cobrar</span>.
                  </p>
                ) : null}

                {checkoutDevolucionListo ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-center text-xs leading-relaxed text-slate-600 dark:text-slate-400 sm:text-sm">
                    Al confirmar, el ticket original quedará como cancelado por devolución, el inventario se
                    restaurará y el importe dejará de contar en totales del día. Entregue al cliente el dinero
                    (o aplique su política de reembolso).
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
                            if (!esFormaTarjeta(v)) setTarjetaUltimos4('');
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
                            {FORMAS_PAGO_UI.map((fp) => (
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
                        <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                          Parcialidades: registre cada cobro (varias tarjetas, efectivo + tarjeta, etc.).
                          {puedeVentaConSaldoPendiente ?
                            ' Con cliente registrado puede dejar saldo pendiente (menos del total o sin pago).'
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
                        Puede escribir el monto exacto y pulsar <strong>Completar venta</strong>: se registrará
                        automáticamente sin usar «Agregar» ni los billetes rápidos.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {esFormaTarjeta(formaPagoAbono) &&
                !esTraspasoTienda &&
                !checkoutDevolucionListo &&
                formaPago !== 'PPC' ? (
                  <div className="space-y-2">
                    <Label>Últimos 4 dígitos (voucher)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="••••"
                      maxLength={4}
                      value={tarjetaUltimos4}
                      onChange={(e) =>
                        setTarjetaUltimos4(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleProcessSale();
                        }
                      }}
                      className="h-11 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-center font-mono text-lg tracking-widest text-slate-900 dark:text-slate-100"
                    />
                    <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-500 sm:text-xs">
                      Los mismos que en el comprobante del terminal, para cruzar ticket y voucher en
                      auditoría.
                      {cobroTarjetaPue ?
                        ' Al completar la venta se registra el cobro por el total mostrado arriba.'
                      : null}
                    </p>
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
                            {esFormaTarjeta(pago.formaPago) &&
                            /^\d{4}$/.test(pago.referencia?.trim() ?? '') ?
                              <span className="text-slate-600 dark:text-slate-500"> · ****{pago.referencia!.trim()}</span>
                            : null}
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
                        ? digitos4TarjetaPendiente().length !== 4
                        : puedeVentaConSaldoPendiente
                          ? false
                          : totalPagadoVenta < totalCobro)
                  }
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white sm:w-auto"
                >
                  {processingSale ? (
                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Check className="mr-2 h-5 w-5" />
                  )}
                  {checkoutDevolucionListo ? 'Confirmar devolución' : 'Completar venta'}
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
                    Ticket anulado {ticketSnapshot.folioVentaOrigen}
                  </p>
                ) : ticketSnapshot?.folio ? (
                  <p className="mb-2 font-mono text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-base">
                    Folio {ticketSnapshot.folio}
                  </p>
                ) : null}
                <p className="mb-1 text-sm text-slate-600 dark:text-slate-400 sm:mb-2">
                  {ticketSnapshot?.modoDevolucion ? 'Monto devuelto al cliente' : 'Total'}
                </p>
                <p className="mb-3 text-3xl font-bold text-cyan-400 sm:mb-4 sm:text-4xl">
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
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
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
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain py-2">
            <button
              type="button"
              onClick={() => {
                setClient(null);
                setPrecioClienteLista('regular');
                setShowClientDialog(false);
              }}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-200 dark:bg-slate-800/80 p-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-800"
            >
              <p className="font-medium text-slate-900 dark:text-slate-100">Mostrador</p>
              <p className="text-xs text-slate-600 dark:text-slate-500">Sin cliente registrado</p>
            </button>
            {clients
              .filter((c) => !c.isMostrador)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClient(c);
                    setPrecioClienteLista(c.listaPreciosId ?? 'regular');
                    setShowClientDialog(false);
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-200/80 dark:bg-slate-800/50 p-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-800"
                >
                  <p className="font-medium text-slate-800 dark:text-slate-200">{c.nombre}</p>
                  {c.rfc ? <p className="text-xs text-slate-600 dark:text-slate-500">RFC: {c.rfc}</p> : null}
                </button>
              ))}
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
              className="bg-cyan-600 text-white hover:bg-cyan-700"
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
        <DialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Precio unitario (con IVA)</DialogTitle>
          </DialogHeader>
          {unitPriceEditStep === 'pin' ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ingrese la contraseña de administrador para modificar el precio.
              </p>
              <Input
                type="password"
                autoComplete="off"
                placeholder="Contraseña"
                value={unitPricePinInput}
                onChange={(e) => setUnitPricePinInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
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
            <div className="space-y-3 py-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Se usa el IVA del producto en catálogo para convertir a precio base en el carrito.
              </p>
              <Label>Nuevo precio con IVA incluido</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={unitPriceInput}
                onChange={(e) => setUnitPriceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveUnitPriceFromDialog();
                  }
                }}
                className="border-slate-300 text-lg dark:border-slate-700 dark:bg-slate-800"
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={closeUnitPriceDialog}>
                  Cancelar
                </Button>
                <Button type="button" onClick={saveUnitPriceFromDialog}>
                  Guardar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
