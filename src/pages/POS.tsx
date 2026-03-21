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
import { useCartStore, useAppStore, useAuthStore } from '@/stores';
import { useProductSearch, useSales, useClients } from '@/hooks';
import type { Product, FormaPago } from '@/types';
import { FORMAS_PAGO } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { printThermalTicket } from '@/lib/printTicket';

// ============================================
// PUNTO DE VENTA (POS) — Vista tipo app, sin scroll de página
// ============================================

type MobileTab = 'cart' | 'checkout';

/** Datos de la venta recién cobrada: el carrito se vacía al completar; el ticket y el modal usan esto. */
type PosTicketSnapshot = {
  clienteNombre: string;
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
};

export function POS() {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const { addSale } = useSales();

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
    addPago,
    removePago,
    setClient,
    clearCart,
    getSubtotal,
    getImpuestos,
    getDescuento,
    getTotal,
    getTotalPagado,
    getCambio,
  } = useCartStore();

  /**
   * Totales derivados con useMemo desde items/discount/pagos: los selectores inline tipo `(s) => s.getTotal()`
   * cambian de identidad cada render y en React 19 + useSyncExternalStore pueden dejar el snapshot desincronizado (ej. botón Cobrar en $0.00).
   */
  const { subtotalVenta, descuentoVenta, impuestosVenta, totalVenta } = useMemo(() => {
    const st = useCartStore.getState();
    return {
      subtotalVenta: st.getSubtotal(),
      descuentoVenta: st.getDescuento(),
      impuestosVenta: st.getImpuestos(),
      totalVenta: st.getTotal(),
    };
  }, [items, discount]);

  const totalPagadoVenta = useMemo(
    () => useCartStore.getState().getTotalPagado(),
    [pagos]
  );

  const cambioVenta = useMemo(
    () => useCartStore.getState().getCambio(),
    [items, discount, pagos]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [ticketSnapshot, setTicketSnapshot] = useState<PosTicketSnapshot | null>(null);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [montoRecibidoInput, setMontoRecibidoInput] = useState('');
  const [processingSale, setProcessingSale] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('cart');
  const [globalDiscFocus, setGlobalDiscFocus] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    if (showPaymentDialog) {
      setMontoRecibidoInput('');
    }
  }, [showPaymentDialog]);

  const commitMontoRecibido = () => {
    const normalized = montoRecibidoInput.replace(',', '.').trim();
    const monto = parseFloat(normalized) || 0;
    if (monto <= 0) {
      addToast({ type: 'warning', message: 'Ingrese un monto mayor a cero' });
      return;
    }
    addPago({ formaPago, monto });
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

  const handleProcessSale = async () => {
    if (items.length === 0) {
      addToast({ type: 'error', message: 'Agregue productos al carrito' });
      return;
    }

    if (getTotalPagado() < getTotal()) {
      addToast({ type: 'error', message: 'El pago es insuficiente' });
      return;
    }

    setProcessingSale(true);

    try {
      const saleData = {
        clienteId: client?.id || 'mostrador',
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
        subtotal: getSubtotal(),
        descuento: getDescuento(),
        impuestos: getImpuestos(),
        total: getTotal(),
        formaPago: formaPago as FormaPago,
        metodoPago: metodoPago as 'PUE' | 'PPD',
        pagos: pagos.map((p) => ({
          id: crypto.randomUUID(),
          formaPago: p.formaPago as FormaPago,
          monto: p.monto,
          referencia: p.referencia,
        })),
        cambio: getCambio(),
        estado: 'completada' as const,
        notas: '',
        usuarioId: user?.id || 'system',
      };

      await addSale(saleData);

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
      setTicketSnapshot({
        clienteNombre,
        lineas,
        subtotal: getSubtotal(),
        impuestos: getImpuestos(),
        total: getTotal(),
        cambio: getCambio(),
      });
      clearCart();
      setShowPaymentDialog(false);
      setShowTicketDialog(true);

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
    setTicketSnapshot(null);
    setShowTicketDialog(false);
    setMobileTab('cart');
    clearCart();
  };

  const handlePrintTicket = () => {
    const snap = ticketSnapshot;
    if (!snap) return;
    printThermalTicket({
      negocio: 'SERVIPARTZ POS',
      fecha: new Date().toLocaleString('es-MX'),
      cliente: snap.clienteNombre,
      lineas: snap.lineas,
      subtotal: snap.subtotal,
      impuestos: snap.impuestos,
      total: snap.total,
      cambio: snap.cambio,
    });
  };

  const handleTicketDialogOpenChange = (open: boolean) => {
    setShowTicketDialog(open);
    if (!open) {
      setTicketSnapshot(null);
      setMobileTab('cart');
    }
  };

  const panelClass =
    'rounded-xl border border-slate-800/50 bg-slate-900/50 shadow-sm';

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 sm:gap-3">
      {/* Pestañas móvil: una vista completa por pestaña (sin scroll de página) */}
      <div
        className={cn(
          'grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-800/60 bg-slate-950/80 p-1 md:hidden'
        )}
      >
        <button
          type="button"
          onClick={() => setMobileTab('cart')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
            mobileTab === 'cart'
              ? 'bg-cyan-500/20 text-cyan-300'
              : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
          )}
        >
          <ShoppingCart className="h-4 w-4 shrink-0" />
          Carrito
          {items.length > 0 ? (
            <span className="rounded-full bg-slate-800 px-1.5 text-xs text-slate-300">
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
              ? 'bg-cyan-500/20 text-cyan-300'
              : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
          )}
        >
          <Wallet className="h-4 w-4 shrink-0" />
          Cobro
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:flex-row md:gap-3 lg:gap-4 xl:gap-5">
        {/* Columna carrito + búsqueda */}
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col gap-2 sm:gap-3',
            mobileTab !== 'cart' && 'hidden md:flex'
          )}
        >
          <div className={cn('shrink-0 p-2 sm:p-3', panelClass)}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 sm:left-3 sm:h-5 sm:w-5" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowProductSearch(true)}
                placeholder="Buscar (F2) · SKU, código, nombre"
                className="h-10 border-slate-700 bg-slate-800/50 pl-9 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 sm:h-11 sm:pl-10 sm:text-base"
              />

              {showProductSearch && searchResults.length > 0 && (
                <div
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(42dvh,16rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-900 shadow-xl sm:mt-2"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {searchResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleAddProduct(product)}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-800/50 p-2.5 text-left transition-colors last:border-0 hover:bg-slate-800/50 sm:p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-200">{product.nombre}</p>
                        <p className="text-xs text-slate-500">SKU: {product.sku}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold text-cyan-400">{formatMoney(product.precioVenta)}</p>
                        <p
                          className={cn(
                            'text-xs',
                            product.existencia <= product.existenciaMinima
                              ? 'text-amber-400'
                              : 'text-slate-500'
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
              'flex min-h-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50'
            )}
          >
            <CardHeader className="shrink-0 space-y-0 border-b border-slate-800/50 py-2 sm:py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100 sm:text-base">
                <ShoppingCart className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                <span className="truncate">Carrito</span>
                <span className="ml-auto text-xs font-normal text-slate-500 sm:text-sm">
                  {items.length} ít.
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {items.length === 0 ? (
                <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-slate-500">
                  <ShoppingCart className="h-12 w-12 opacity-40 sm:h-16 sm:w-16" />
                  <p className="text-sm">Vacío</p>
                  <p className="text-xs text-slate-600">Busque y agregue productos</p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                  <div className="divide-y divide-slate-800/50">
                    {items.map((item) => (
                      <div
                        key={item.product.id}
                        className="grid gap-2 p-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3 sm:p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">{item.product.nombre}</p>
                          <p className="text-xs text-slate-500">SKU {item.product.sku}</p>
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
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 transition-colors hover:bg-slate-700"
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
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 transition-colors hover:bg-slate-700"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Percent className="hidden h-3.5 w-3.5 text-slate-500 sm:block" />
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={item.discount}
                              onFocus={(e) => {
                                if (item.discount === 0) e.target.select();
                              }}
                              onChange={(e) =>
                                updateDiscount(item.product.id, parseFloat(e.target.value) || 0)
                              }
                              className="h-8 w-14 border-slate-700 bg-slate-800 px-1 text-center text-xs text-slate-100 sm:w-16"
                              min={0}
                              max={100}
                              aria-label="Descuento porcentaje"
                            />
                          </div>

                          <p className="min-w-[4.5rem] text-right text-sm font-bold text-slate-200">
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
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-800/60 bg-slate-950/90 p-2 md:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Total</p>
              <p className="truncate text-lg font-bold text-cyan-400">{formatMoney(totalVenta)}</p>
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
            'flex w-full shrink-0 flex-col gap-2 sm:gap-3',
            'md:min-h-0 md:w-[min(100%,26rem)] lg:w-[min(100%,30rem)] xl:w-[min(100%,34rem)]',
            mobileTab !== 'checkout' && 'hidden md:flex'
          )}
        >
          <div className={cn('shrink-0 p-2 sm:p-3', panelClass)}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 sm:h-10 sm:w-10">
                  <User className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
                    Cliente
                  </p>
                  <p className="truncate text-sm font-medium text-slate-200 sm:text-base">
                    {client?.nombre || 'Mostrador'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs text-cyan-400 hover:text-cyan-300 sm:h-9 sm:text-sm"
                onClick={() => {
                  void refreshClients();
                  setShowClientDialog(true);
                }}
              >
                Cambiar
              </Button>
            </div>
          </div>

          <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible border-slate-800/50 bg-slate-900/50 md:min-h-0">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-visible p-2 sm:p-3 md:p-4">
              <div className="shrink-0 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm">
                  <span className="text-slate-400">Subtotal</span>
                  <span className="text-right text-slate-300">{formatMoney(subtotalVenta)}</span>
                  <span className="text-slate-400">Descuento</span>
                  <span className="text-right text-amber-400">-{formatMoney(descuentoVenta)}</span>
                  <span className="text-slate-400">IVA 16%</span>
                  <span className="text-right text-slate-300">{formatMoney(impuestosVenta)}</span>
                </div>

                <div className="border-t border-slate-800 pt-2">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-medium text-slate-200 sm:text-base">Total</span>
                    <span className="text-xl font-bold tabular-nums text-cyan-400 sm:text-2xl lg:text-3xl">
                      {formatMoney(totalVenta)}
                    </span>
                  </div>
                </div>
              </div>

              {/*
                Controles de pago fuera de overflow-y-auto: evita que Radix Select
                (portal + focus) choque con el scroll y provoque “refresh” o cierres raros.
              */}
              <div className="shrink-0 space-y-3 border-t border-slate-800/80 pt-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 sm:text-xs">Forma de pago</Label>
                  <Select value={formaPago} onValueChange={setFormaPago}>
                    <SelectTrigger className="h-9 w-full min-w-0 border-slate-700 bg-slate-800 text-xs text-slate-100 sm:h-10 sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      sideOffset={6}
                      align="start"
                      className="z-[300] max-h-[min(50dvh,18rem)] w-[var(--radix-select-trigger-width)] border-slate-800 bg-slate-900"
                    >
                      {FORMAS_PAGO.map((fp) => (
                        <SelectItem
                          key={fp.clave}
                          value={fp.clave}
                          className="text-slate-100"
                        >
                          {fp.descripcion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 sm:text-xs">Método</Label>
                  <Select value={metodoPago} onValueChange={setMetodoPago}>
                    <SelectTrigger className="h-9 w-full min-w-0 border-slate-700 bg-slate-800 text-xs text-slate-100 sm:h-10 sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      sideOffset={6}
                      align="start"
                      className="z-[300] w-[var(--radix-select-trigger-width)] border-slate-800 bg-slate-900"
                    >
                      <SelectItem value="PUE" className="text-slate-100">
                        Una exhibición (PUE)
                      </SelectItem>
                      <SelectItem value="PPD" className="text-slate-100">
                        Parcialidades (PPD)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 sm:text-xs">Desc. global %</Label>
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
                    className="h-9 w-full border-slate-700 bg-slate-800 text-slate-100 sm:h-10"
                    min={0}
                    max={100}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="shrink-0 space-y-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={() => setShowPaymentDialog(true)}
              disabled={items.length === 0}
              className="h-11 w-full min-w-0 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 sm:h-12 sm:text-base md:h-14 md:text-lg"
            >
              <Wallet className="mr-2 h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span className="min-w-0 tabular-nums">
                Cobrar {formatMoney(totalVenta)}
              </span>
            </Button>

            <Button
              type="button"
              onClick={clearCart}
              variant="outline"
              disabled={items.length === 0}
              className="h-10 w-full rounded-xl border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 sm:h-11"
            >
              <X className="mr-2 h-4 w-4" />
              Cancelar venta
            </Button>
          </div>
        </aside>
      </div>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="top-4 left-1/2 max-h-[calc(100dvh-1rem)] w-[min(calc(100vw-1rem),28rem)] max-w-none -translate-x-1/2 translate-y-0 overflow-x-hidden overflow-y-auto border-slate-800 bg-slate-900 p-4 text-slate-100 sm:top-6 sm:max-h-[calc(100dvh-1.5rem)] sm:w-[min(calc(100vw-2rem),32rem)] sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Receipt className="h-5 w-5 text-cyan-400 sm:h-6 sm:w-6" />
              Procesar pago
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1 sm:space-y-4 sm:py-2">
            <div className="rounded-xl bg-slate-800/50 p-3 text-center sm:p-4">
              <p className="mb-1 text-xs text-slate-400 sm:text-sm">Total a pagar</p>
              <p className="text-2xl font-bold text-cyan-400 sm:text-4xl">{formatMoney(totalVenta)}</p>
            </div>

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
                  className="h-12 border-slate-700 bg-slate-800 text-center text-xl text-slate-100 sm:h-14 sm:text-2xl"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12 shrink-0 bg-slate-800 text-slate-100 hover:bg-slate-700 sm:h-14"
                  onClick={commitMontoRecibido}
                >
                  Agregar
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[50, 100, 200, 500, 1000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => addPago({ formaPago, monto: amount })}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700"
                >
                  {formatMoney(amount)}
                </button>
              ))}
            </div>

            {pagos.length > 0 && (
              <div className="space-y-2">
                <Label>Pagos recibidos</Label>
                <div className="space-y-2">
                  {pagos.map((pago, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg bg-slate-800/50 p-2.5 sm:p-3"
                    >
                      <span className="truncate pr-2 text-sm text-slate-300">
                        {FORMAS_PAGO.find((fp) => fp.clave === pago.formaPago)?.descripcion}
                      </span>
                      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                        <span className="font-bold text-slate-200">{formatMoney(pago.monto)}</span>
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

            {cambioVenta > 0 && (
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
              onClick={() => setShowPaymentDialog(false)}
              className="w-full border-slate-700 text-slate-400 sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleProcessSale()}
              disabled={totalPagadoVenta < totalVenta || processingSale}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white sm:w-auto"
            >
              {processingSale ? (
                <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Check className="mr-2 h-5 w-5" />
              )}
              Completar venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTicketDialog} onOpenChange={handleTicketDialogOpenChange}>
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-lg sm:text-xl">¡Venta completada!</DialogTitle>
          </DialogHeader>

          <div className="py-4 text-center sm:py-6">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 sm:mb-4 sm:h-20 sm:w-20">
              <Check className="h-8 w-8 text-emerald-400 sm:h-10 sm:w-10" />
            </div>
            <p className="mb-1 text-sm text-slate-400 sm:mb-2">Total</p>
            <p className="mb-3 text-3xl font-bold text-cyan-400 sm:mb-4 sm:text-4xl">
              {formatMoney(ticketSnapshot?.total ?? 0)}
            </p>
            <p className="text-xs text-slate-500 sm:text-sm">
              Cambio: {formatMoney(ticketSnapshot?.cambio ?? 0)}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={handlePrintTicket}
              variant="outline"
              className="flex-1 border-slate-700 text-slate-400"
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
        </DialogContent>
      </Dialog>

      <Dialog open={showClientDialog} onOpenChange={setShowClientDialog}>
        <DialogContent className="max-h-[min(85dvh,28rem)] border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cliente de la venta</DialogTitle>
          </DialogHeader>
          <div className="max-h-[min(55dvh,18rem)] space-y-2 overflow-y-auto py-2">
            <button
              type="button"
              onClick={() => {
                setClient(null);
                setShowClientDialog(false);
              }}
              className="w-full rounded-lg border border-slate-700/80 bg-slate-800/80 p-3 text-left transition-colors hover:bg-slate-800"
            >
              <p className="font-medium text-slate-100">Mostrador</p>
              <p className="text-xs text-slate-500">Sin cliente registrado</p>
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
                  className="w-full rounded-lg border border-slate-800 bg-slate-800/50 p-3 text-left transition-colors hover:bg-slate-800"
                >
                  <p className="font-medium text-slate-200">{c.nombre}</p>
                  {c.rfc ? <p className="text-xs text-slate-500">RFC: {c.rfc}</p> : null}
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
