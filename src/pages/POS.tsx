import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Receipt,
  X,
  Check,
  Printer,
  Percent,
  User,
  Wallet,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useShallow } from 'zustand/react/shallow';
import { useCartStore, useAppStore, useAuthStore } from '@/stores';
import { useProductSearch, useSales, useClients, useEffectiveSucursalId } from '@/hooks';
import type { Product, FormaPago, Sale, Sucursal } from '@/types';
import { FORMAS_PAGO_UI } from '@/types';
import { getSaleByFolio } from '@/db/database';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { printThermalTicket } from '@/lib/printTicket';

// ============================================
// PUNTO DE VENTA (POS) — Vista tipo app, sin scroll de página
// ============================================

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
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useAppStore();
  const { addSale, cancelSale: ejecutarCancelacionVenta } = useSales();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [sucursalesCat, setSucursalesCat] = useState<Sucursal[]>([]);
  useEffect(() => subscribeSucursales(setSucursalesCat), []);

  const formasPagoPos = useMemo(() => {
    const base = [
      ...FORMAS_PAGO_UI,
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
      setGlobalDiscount: s.setGlobalDiscount,
      setFormaPago: s.setFormaPago,
      setMetodoPago: s.setMetodoPago,
      transferenciaDestinoSucursalId: s.transferenciaDestinoSucursalId,
      setTransferenciaDestinoSucursalId: s.setTransferenciaDestinoSucursalId,
      addPago: s.addPago,
      removePago: s.removePago,
      setClient: s.setClient,
      clearCart: s.clearCart,
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
    setGlobalDiscount,
    setFormaPago,
    setMetodoPago,
    transferenciaDestinoSucursalId,
    setTransferenciaDestinoSucursalId,
    addPago,
    removePago,
    setClient,
    clearCart,
    getTotalPagado,
    getCambio,
  } = cart;

  const [devolucionFolioInput, setDevolucionFolioInput] = useState('');
  const [devolucionSaleResuelta, setDevolucionSaleResuelta] = useState<Sale | null>(null);
  const [devolucionBusy, setDevolucionBusy] = useState(false);

  const esFormaDevolucion = formaPago === 'DEV';

  useEffect(() => {
    if (!formasPagoPos.some((fp) => fp.clave === formaPago)) {
      setFormaPago('01');
    }
  }, [formasPagoPos, formaPago, setFormaPago]);

  useEffect(() => {
    if (!esFormaDevolucion) {
      setDevolucionFolioInput('');
      setDevolucionSaleResuelta(null);
    }
  }, [esFormaDevolucion]);

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
  const [processingSale, setProcessingSale] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('cart');
  const [globalDiscFocus, setGlobalDiscFocus] = useState(false);
  /** Fila del carrito cuyo % descuento está enfocado (vacío visual si es 0, como desc. global). */
  const [lineDiscountFocusProductId, setLineDiscountFocusProductId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productSearchWrapRef = useRef<HTMLDivElement>(null);

  const { results: searchResults, search: searchProducts } = useProductSearch();
  const { clients, refresh: refreshClients } = useClients();

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

  const openCheckoutDialog = () => {
    setCheckoutPhase('payment');
    setCheckoutOpen(true);
  };

  useEffect(() => {
    if (checkoutOpen && checkoutPhase === 'payment') {
      setMontoRecibidoInput('');
      setTarjetaUltimos4('');
    }
  }, [checkoutOpen, checkoutPhase]);

  const esFormaTarjeta = (fp: string) => fp === '04' || fp === '28';
  const esFormaEfectivo = (fp: string) => fp === '01';

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
    if (esFormaTarjeta(formaPago)) {
      const d4 = digitos4TarjetaPendiente();
      if (d4.length !== 4) {
        toastTarjeta4Requeridos();
        return;
      }
      addPago({ formaPago, monto, referencia: d4 });
      setTarjetaUltimos4('');
    } else {
      addPago({ formaPago, monto });
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

    if (items.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos al carrito' });
      return;
    }

    const cobroTarjetaPueLocal =
      !esTraspasoTienda && esFormaTarjeta(formaPago) && metodoPago === 'PUE';

    let pagosParaVenta = pagos;

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
      if (getTotalPagado() < totalCobro) {
        addToast({ type: 'error', message: 'El pago es insuficiente' });
        return;
      }
    }

    if (!esTraspasoTienda) {
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

    setProcessingSale(true);

    try {
      const cambioVentaFinal = esTraspasoTienda ? 0 : cobroTarjetaPueLocal ? 0 : getCambio();

      const cajeroNombre =
        user?.name?.trim() || user?.username?.trim() || user?.email?.trim() || undefined;
      const destNombre =
        sucursalesCat.find((s) => s.id === transferenciaDestinoSucursalId)?.nombre ??
        transferenciaDestinoSucursalId;
      const saleData = {
        clienteId: client?.id || 'mostrador',
        /** Snapshot para ticket / reimpresión (solo `clienteId` dejaba el UUID en el ticket). */
        ...(client ? { cliente: client } : {}),
        productos: items.map((item) => ({
          id: crypto.randomUUID(),
          productId: item.product.id,
          cantidad: item.quantity,
          precioUnitario: item.product.precioVenta,
          descuento: item.discount,
          impuesto: item.product.impuesto,
          subtotal:
            item.product.precioVenta * item.quantity * (1 - item.discount / 100),
          total:
            item.product.precioVenta *
            item.quantity *
            (1 - item.discount / 100) *
            (1 + item.product.impuesto / 100),
        })),
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
        notas: esTraspasoTienda ? `Traspaso tienda a tienda → ${destNombre}` : '',
        transferenciaSucursalDestinoId: esTraspasoTienda
          ? transferenciaDestinoSucursalId.trim()
          : undefined,
        usuarioId: user?.id || 'system',
        usuarioNombre: cajeroNombre,
      };

      const { folio: folioVenta } = await addSale(saleData);

      const clienteNombre = client?.nombre || 'Mostrador';
      const lineas = items.map((item) => {
        const unit = item.product.precioVenta * (1 - item.discount / 100);
        const lineTot = item.product.precioVenta * item.quantity * (1 - item.discount / 100);
        return {
          descripcion: item.product.nombre,
          cantidad: item.quantity,
          precioUnit: unit,
          total: lineTot,
        };
      });
      const resumenPagos =
        !esTraspasoTienda && pagosParaVenta.length > 0
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
        sucursalId: effectiveSucursalId,
        folio: folioVenta?.trim() || undefined,
        notas: esTraspasoTienda ? saleData.notas : undefined,
        resumenPagos,
      });
      clearCart();
      // Mismo portal de diálogo: pasar a "success" evita dos Dialog de Radix a la vez (insertBefore/removeChild).
      setCheckoutPhase('success');

      addToast({ type: 'success', message: 'Venta completada exitosamente' });
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 sm:gap-3">
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
                        <p className="font-bold text-cyan-400">{formatMoney(product.precioVenta)}</p>
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
                            {formatMoney(item.product.precioVenta)} c/u
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
                            {formatMoney(
                              item.product.precioVenta *
                                item.quantity *
                                (1 - item.discount / 100)
                            )}
                          </p>

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
            'flex w-full flex-col gap-2 sm:gap-3',
            'max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-y-contain',
            'lg:min-h-0 lg:w-[min(100%,26rem)] lg:shrink-0 lg:overflow-hidden xl:w-[min(100%,30rem)] 2xl:w-[min(100%,34rem)]',
            mobileTab !== 'checkout' && 'hidden lg:flex'
          )}
        >
          <button
            type="button"
            className={cn(
              'flex w-full shrink-0 items-center justify-between gap-2 p-2 text-left sm:gap-3 sm:p-3',
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
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 sm:h-10 sm:w-10">
                <User className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-500 sm:text-xs">
                  Cliente
                </p>
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base">
                  {client?.nombre || 'Mostrador'}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-cyan-700 sm:text-sm dark:text-cyan-400">
              Cambiar
            </span>
          </button>

          <Card className="flex min-w-0 flex-col overflow-visible border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 max-lg:flex-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <CardContent className="flex flex-col gap-3 overflow-visible p-2 sm:p-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:p-4">
              <div className="shrink-0 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(subtotalCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">Descuento</span>
                  <span className="text-right text-amber-400">-{formatMoney(descuentoCobro)}</span>
                  <span className="text-slate-600 dark:text-slate-400">IVA 16%</span>
                  <span className="text-right text-slate-700 dark:text-slate-300">{formatMoney(impuestosCobro)}</span>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-2">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base">Total</span>
                    <span className="text-xl font-bold tabular-nums text-cyan-400 sm:text-2xl lg:text-3xl">
                      {formatMoney(totalCobro)}
                    </span>
                  </div>
                </div>
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
              </div>

              {/*
                Controles de pago fuera de overflow-y-auto: evita que Radix Select
                (portal + focus) choque con el scroll y provoque “refresh” o cierres raros.
              */}
              <div className="shrink-0 space-y-3 border-t border-slate-200 dark:border-slate-800/80 pt-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">Forma de pago</Label>
                  <Select
                    value={formaPago}
                    onValueChange={(v) => {
                      setFormaPago(v);
                      if (v === 'TTS' && isAdmin) {
                        useCartStore.setState({ pagos: [] });
                      }
                      if (v === 'DEV') {
                        useCartStore.setState({ pagos: [] });
                      }
                      if (v !== 'TTS') setTransferenciaDestinoSucursalId('');
                    }}
                  >
                    <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:h-10 md:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      sideOffset={6}
                      hideScrollButtons
                      className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                    >
                      {formasPagoPos.map((fp) => (
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

                {formaPago === 'TTS' && isAdmin ? (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">Tienda destino</Label>
                    <Select
                      value={transferenciaDestinoSucursalId || '__none__'}
                      onValueChange={(v) =>
                        setTransferenciaDestinoSucursalId(v === '__none__' ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:text-sm">
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

                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">Método</Label>
                  <Select value={metodoPago} onValueChange={setMetodoPago}>
                    <SelectTrigger className="h-10 w-full min-w-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:text-sm">
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

                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 dark:text-slate-400 sm:text-xs">Desc. global %</Label>
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
                    className="h-10 w-full border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-base text-slate-900 dark:text-slate-100 md:h-10 md:text-sm"
                    min={0}
                    max={100}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="max-lg:mt-1 shrink-0 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={() => openCheckoutDialog()}
              disabled={
                esFormaDevolucion ?
                  !devolucionSaleResuelta ||
                  devolucionSaleResuelta.estado !== 'completada' ||
                  items.length > 0
                : items.length === 0 ||
                  (formaPago === 'TTS' && isAdmin && !transferenciaDestinoSucursalId?.trim())
              }
              className="h-11 w-full min-w-0 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-base font-bold text-white shadow-lg shadow-cyan-500/25 sm:h-12 md:h-14 md:text-lg"
            >
              Cobrar
            </Button>

            <Button
              type="button"
              onClick={clearCart}
              variant="outline"
              disabled={items.length === 0}
              className="h-10 w-full rounded-xl border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-slate-800 dark:text-slate-200 sm:h-11"
            >
              <X className="mr-2 h-4 w-4" />
              Cancelar venta
            </Button>
          </div>
        </aside>
      </div>

      <Dialog open={checkoutOpen} onOpenChange={handleCheckoutOpenChange}>
        <DialogContent
          className={cn(
            'left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100',
            checkoutPhase === 'payment'
              ? 'max-h-[min(88dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-4.5rem))] w-[min(calc(100vw-1rem),28rem)] min-w-0 overflow-y-auto overflow-x-auto overscroll-y-contain px-4 py-4 pl-4 pr-12 sm:top-[50%] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[min(calc(100vw-2rem),32rem)] sm:p-6 sm:pr-14 md:w-[min(calc(100vw-2rem),40rem)] lg:w-[min(calc(100vw-2rem),48rem)] md:overflow-x-hidden'
              : 'w-[min(calc(100vw-1rem),24rem)] min-w-0 px-4 py-4 pl-4 pr-12 sm:max-w-sm sm:p-6 sm:pr-14 md:w-[min(calc(100vw-2rem),28rem)]'
          )}
        >
          {checkoutPhase === 'payment' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Receipt className="h-5 w-5 text-cyan-400 sm:h-6 sm:w-6" />
                  {checkoutDevolucionListo ? 'Confirmar devolución' : 'Procesar pago'}
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

                {checkoutDevolucionListo ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-center text-xs leading-relaxed text-slate-600 dark:text-slate-400 sm:text-sm">
                    Al confirmar, el ticket original quedará como cancelado por devolución, el inventario se
                    restaurará y el importe dejará de contar en totales del día. Entregue al cliente el dinero
                    (o aplique su política de reembolso).
                  </p>
                ) : null}

                {!cobroTarjetaPue && !esTraspasoTienda && !checkoutDevolucionListo ? (
                  <div className="space-y-2">
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
                            commitMontoRecibido();
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
                  </div>
                ) : null}

                {esFormaTarjeta(formaPago) && !esTraspasoTienda && !checkoutDevolucionListo ? (
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

                {esFormaEfectivo(formaPago) && !esTraspasoTienda && !checkoutDevolucionListo ? (
                  <div className="flex flex-wrap gap-2">
                    {[50, 100, 200, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => addPago({ formaPago, monto: amount })}
                        className="rounded-lg bg-slate-200 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-700"
                      >
                        {formatMoney(amount)}
                      </button>
                    ))}
                  </div>
                ) : null}

                {pagos.length > 0 && !cobroTarjetaPue && !checkoutDevolucionListo && (
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

                {!esTraspasoTienda && !checkoutDevolucionListo && cambioVenta > 0 && (
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
    </div>
  );
}
