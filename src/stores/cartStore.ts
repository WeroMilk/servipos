import { create } from 'zustand';
import type { Product, CartItem, Client } from '@/types';

// ============================================
// STORE DEL CARRITO DE COMPRAS (POS)
// ============================================

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

  // Acciones
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  setClient: (client: Client | null) => void;
  setGlobalDiscount: (discount: number) => void;
  setFormaPago: (formaPago: string) => void;
  setMetodoPago: (metodoPago: string) => void;
  addPago: (pago: { formaPago: string; monto: number; referencia?: string }) => void;
  removePago: (index: number) => void;
  setNotas: (notas: string) => void;
  setTransferenciaDestinoSucursalId: (id: string) => void;
  clearCart: () => void;
  
  // Cálculos
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

  // Acciones
  addItem: (product: Product, quantity: number = 1) => {
    const { items } = get();
    const existingItem = items.find(item => item.product.id === product.id);

    if (existingItem) {
      // Verificar stock
      if (existingItem.quantity + quantity > product.existencia) {
        throw new Error('Stock insuficiente');
      }

      set({
        items: items.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        ),
      });
    } else {
      // Verificar stock
      if (quantity > product.existencia) {
        throw new Error('Stock insuficiente');
      }

      set({
        items: [...items, { product, quantity, discount: 0 }],
      });
    }
  },

  removeItem: (productId: string) => {
    set({ items: get().items.filter(item => item.product.id !== productId) });
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }

    const item = get().items.find(i => i.product.id === productId);
    if (item && quantity > item.product.existencia) {
      throw new Error('Stock insuficiente');
    }

    set({
      items: get().items.map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      ),
    });
  },

  updateDiscount: (productId: string, discount: number) => {
    set({
      items: get().items.map(item =>
        item.product.id === productId ? { ...item, discount } : item
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
    });
  },

  // Cálculos (Number() evita NaN → formatMoney muestra $0.00)
  getSubtotal: () => {
    return get().items.reduce((sum, item) => {
      const price = Number(item.product.precioVenta) || 0;
      const qty = Number(item.quantity) || 0;
      const discPct = Number(item.discount) || 0;
      const itemSubtotal = price * qty;
      const itemDiscount = itemSubtotal * (discPct / 100);
      return sum + (itemSubtotal - itemDiscount);
    }, 0);
  },

  getImpuestos: () => {
    const subtotal = get().getSubtotal();
    const globalPct = Number(get().discount) || 0;
    const globalDiscount = subtotal * (globalPct / 100);
    const base = subtotal - globalDiscount;
    return base * 0.16; // IVA 16%
  },

  getDescuento: () => {
    const itemDiscounts = get().items.reduce((sum, item) => {
      const price = Number(item.product.precioVenta) || 0;
      const qty = Number(item.quantity) || 0;
      const discPct = Number(item.discount) || 0;
      const itemSubtotal = price * qty;
      return sum + itemSubtotal * (discPct / 100);
    }, 0);

    const subtotal = get().getSubtotal();
    const globalPct = Number(get().discount) || 0;
    const globalDiscount = subtotal * (globalPct / 100);

    return itemDiscounts + globalDiscount;
  },

  getTotal: () => {
    const subtotal = get().getSubtotal();
    const globalPct = Number(get().discount) || 0;
    const globalDiscountAmt = subtotal * (globalPct / 100);
    const base = subtotal - globalDiscountAmt;
    const impuestos = get().getImpuestos();
    const t = base + impuestos;
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
