import { create } from 'zustand';
import type { Product, CartItem, Client } from '@/types';
import type { ClientPriceListId } from '@/lib/clientPriceLists';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';

// ============================================
// STORE DEL CARRITO DE COMPRAS (POS)
// ============================================

function lineUnitNet(item: CartItem): number {
  const u = Number(item.precioUnitarioOverride ?? item.product.precioVenta) || 0;
  const discPct = Number(item.discount) || 0;
  return u * (1 - discPct / 100);
}

function subtotalAfterLineDiscounts(items: CartItem[]): number {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    return sum + lineUnitNet(item) * qty;
  }, 0);
}

interface CartState {
  items: CartItem[];
  client: Client | null;
  discount: number;
  formaPago: string;
  metodoPago: string;
  pagos: { formaPago: string; monto: number; referencia?: string }[];
  notas: string;
  /** Sucursal destino para forma de pago traspaso tienda–tienda (solo admin). */
  transferenciaDestinoSucursalId: string;
  /** Lista "Precios por cliente" (descuento adicional sobre subtotal de líneas). */
  precioClienteListaId: ClientPriceListId;

  // Acciones
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  updateLineUnitPrice: (productId: string, precioUnitarioSinIva: number) => void;
  setClient: (client: Client | null) => void;
  setGlobalDiscount: (discount: number) => void;
  setFormaPago: (formaPago: string) => void;
  setMetodoPago: (metodoPago: string) => void;
  setPrecioClienteLista: (id: ClientPriceListId) => void;
  addPago: (pago: { formaPago: string; monto: number; referencia?: string }) => void;
  removePago: (index: number) => void;
  setNotas: (notas: string) => void;
  setTransferenciaDestinoSucursalId: (id: string) => void;
  clearCart: () => void;

  // Cálculos (Number() evita NaN → formatMoney muestra $0.00)
  getSubtotal: () => number;
  getImpuestos: () => number;
  getDescuento: () => number;
  getTotal: () => number;
  getCambio: () => number;
  getTotalPagado: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  // Estado inicial
  items: [],
  client: null,
  discount: 0,
  formaPago: '01', // Efectivo
  metodoPago: 'PUE',
  pagos: [],
  notas: '',
  transferenciaDestinoSucursalId: '',
  precioClienteListaId: 'regular',

  // Acciones
  addItem: (product: Product, quantity: number = 1) => {
    const { items } = get();
    const existingItem = items.find((item) => item.product.id === product.id);

    if (existingItem) {
      if (existingItem.quantity + quantity > product.existencia) {
        throw new Error('Stock insuficiente');
      }

      set({
        items: items.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
        ),
      });
    } else {
      if (quantity > product.existencia) {
        throw new Error('Stock insuficiente');
      }

      set({
        items: [...items, { product, quantity, discount: 0 }],
      });
    }
  },

  removeItem: (productId: string) => {
    set({ items: get().items.filter((item) => item.product.id !== productId) });
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }

    const item = get().items.find((i) => i.product.id === productId);
    if (item && quantity > item.product.existencia) {
      throw new Error('Stock insuficiente');
    }

    set({
      items: get().items.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      ),
    });
  },

  updateDiscount: (productId: string, discount: number) => {
    set({
      items: get().items.map((item) =>
        item.product.id === productId ? { ...item, discount } : item
      ),
    });
  },

  updateLineUnitPrice: (productId: string, precioUnitarioSinIva: number) => {
    const p = Number(precioUnitarioSinIva);
    if (!Number.isFinite(p) || p < 0) return;
    set({
      items: get().items.map((item) =>
        item.product.id === productId ? { ...item, precioUnitarioOverride: p } : item
      ),
    });
  },

  setClient: (client: Client | null) => {
    set({ client });
  },

  setGlobalDiscount: (discount: number) => {
    set({ discount });
  },

  setFormaPago: (formaPago: string) => {
    set({ formaPago });
  },

  setMetodoPago: (metodoPago: string) => {
    set({ metodoPago });
  },

  setPrecioClienteLista: (id: ClientPriceListId) => {
    set({ precioClienteListaId: id });
  },

  addPago: (pago: { formaPago: string; monto: number; referencia?: string }) => {
    set({ pagos: [...get().pagos, pago] });
  },

  removePago: (index: number) => {
    const pagos = [...get().pagos];
    pagos.splice(index, 1);
    set({ pagos });
  },

  setNotas: (notas: string) => {
    set({ notas });
  },

  setTransferenciaDestinoSucursalId: (id: string) => {
    set({ transferenciaDestinoSucursalId: id });
  },

  clearCart: () => {
    set({
      items: [],
      client: null,
      discount: 0,
      formaPago: '01',
      metodoPago: 'PUE',
      pagos: [],
      notas: '',
      transferenciaDestinoSucursalId: '',
      precioClienteListaId: 'regular',
    });
  },

  getSubtotal: () => subtotalAfterLineDiscounts(get().items),

  getImpuestos: () => {
    const S0 = subtotalAfterLineDiscounts(get().items);
    const listaPct = getListaPrecioClientePct(get().precioClienteListaId);
    const S1 = S0 * (1 - listaPct / 100);
    const globalPct = Number(get().discount) || 0;
    const S2 = S1 * (1 - globalPct / 100);
    return S2 * 0.16;
  },

  getDescuento: () => {
    const items = get().items;
    const rawLineSum = items.reduce((sum, item) => {
      const u = Number(item.precioUnitarioOverride ?? item.product.precioVenta) || 0;
      const q = Number(item.quantity) || 0;
      return sum + u * q;
    }, 0);

    const S0 = subtotalAfterLineDiscounts(items);
    const lineDiscAmt = rawLineSum - S0;

    const listaPct = getListaPrecioClientePct(get().precioClienteListaId);
    const listaDiscAmt = S0 * (listaPct / 100);
    const S1 = S0 - listaDiscAmt;

    const globalPct = Number(get().discount) || 0;
    const globalDiscAmt = S1 * (globalPct / 100);

    return lineDiscAmt + listaDiscAmt + globalDiscAmt;
  },

  getTotal: () => {
    const S0 = subtotalAfterLineDiscounts(get().items);
    const listaPct = getListaPrecioClientePct(get().precioClienteListaId);
    const S1 = S0 * (1 - listaPct / 100);
    const globalPct = Number(get().discount) || 0;
    const S2 = S1 * (1 - globalPct / 100);
    const imp = S2 * 0.16;
    const t = S2 + imp;
    return Number.isFinite(t) ? t : 0;
  },

  getTotalPagado: () => {
    return get().pagos.reduce((sum, pago) => sum + pago.monto, 0);
  },

  getCambio: () => {
    const total = get().getTotal();
    const pagado = get().getTotalPagado();
    return Math.max(0, pagado - total);
  },
}));
