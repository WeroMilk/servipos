import { create } from 'zustand';
import type { Product, CartItem, Client } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';
import {
  getCartLineUnitSinIvaBase,
  getProductUnitSinIvaForClienteList,
} from '@/lib/productListPricing';

// ============================================
// STORE DEL CARRITO DE COMPRAS (POS)
// ============================================

function lineUnitNet(item: CartItem, listaId: ClientPriceListId): number {
  const u = getCartLineUnitSinIvaBase(item, listaId);
  const discPct = Number(item.discount) || 0;
  return u * (1 - discPct / 100);
}

function subtotalAfterLineDiscounts(items: CartItem[], listaId: ClientPriceListId): number {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    return sum + lineUnitNet(item, listaId) * qty;
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
  /** Lista "Precios por cliente" (precio por producto o % sobre `precioVenta`). */
  precioClienteListaId: ClientPriceListId;

  // Acciones
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  updateLineUnitPrice: (productId: string, precioUnitarioSinIva: number) => void;
  /** Catálogo por lista en esta línea (quita precio manual). */
  applyLinePrecioFromLista: (productId: string, listaId: ClientPriceListId) => void;
  /** Quita la lista propia de la línea; sigue la lista global del ticket (no quita precio manual). */
  resetLinePrecioToTicketLista: (productId: string) => void;
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
  /** Reemplaza el carrito al retomar una venta abierta (`pendiente`) sin validar stock. */
  replaceCartForOpenSaleResume: (params: {
    items: CartItem[];
    client: Client | null;
    globalDiscount: number;
    precioClienteListaId: ClientPriceListId;
  }) => void;
  /** Reemplaza el carrito con un borrador persistido (nube/local), normalizando campos faltantes. */
  replaceCartDraft: (draft: Partial<CartDraftSnapshot> | null | undefined) => void;
  /** Sincroniza `product` embebido con el catálogo actual (Realtime); no toca overrides ni descuentos de línea. */
  reconcileCartProductsFromCatalog: (catalog: Product[]) => void;

  // Cálculos (Number() evita NaN → formatMoney muestra $0.00)
  getSubtotal: () => number;
  getImpuestos: () => number;
  getDescuento: () => number;
  getTotal: () => number;
  getCambio: () => number;
  getTotalPagado: () => number;
}

export type CartDraftSnapshot = {
  items: CartItem[];
  client: Client | null;
  discount: number;
  formaPago: string;
  metodoPago: string;
  pagos: { formaPago: string; monto: number; referencia?: string }[];
  notas: string;
  transferenciaDestinoSucursalId: string;
  precioClienteListaId: ClientPriceListId;
};

const EMPTY_CART_DRAFT: CartDraftSnapshot = {
  items: [],
  client: null,
  discount: 0,
  formaPago: '01',
  metodoPago: 'PUE',
  pagos: [],
  notas: '',
  transferenciaDestinoSucursalId: '',
  precioClienteListaId: 'regular',
};

function coerceCartItemPrecioLista(it: CartItem): CartItem {
  const raw = it.precioListaId;
  if (
    typeof raw === 'string' &&
    (CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(raw)
  ) {
    return { ...it, precioListaId: raw as ClientPriceListId };
  }
  const { precioListaId: _drop, ...rest } = it;
  return rest as CartItem;
}

function stableStringifyPreciosListas(map: Product['preciosPorListaCliente']): string {
  if (map == null || typeof map !== 'object') return 'null';
  const keys = Object.keys(map).sort();
  const norm: Record<string, number | undefined> = {};
  for (const k of keys) {
    const v = map[k as keyof typeof map];
    norm[k] = typeof v === 'number' ? v : v != null && v !== '' ? Number(v) : undefined;
  }
  return JSON.stringify(norm);
}

/** Firma estable para reconciliar carrito ↔ catálogo (evita `set` en bucle por orden de keys o `updatedAt`). */
function catalogProductSyncSignature(p: Product): string {
  const pv = Number(p.precioVenta) || 0;
  const ex = typeof p.existencia === 'number' ? p.existencia : Number(p.existencia) || 0;
  const em =
    typeof p.existenciaMinima === 'number' ? p.existenciaMinima : Number(p.existenciaMinima) || 0;
  return [
    Math.round(pv * 1e6) / 1e6,
    Number(p.impuesto) || 0,
    p.preciosListaIncluyenIva === true ? '1' : p.preciosListaIncluyenIva === false ? '0' : '',
    stableStringifyPreciosListas(p.preciosPorListaCliente),
    ex,
    em,
  ].join('\u001f');
}

function sanitizeCartDraft(draft: Partial<CartDraftSnapshot> | null | undefined): CartDraftSnapshot {
  if (!draft) return { ...EMPTY_CART_DRAFT };
  const listId = draft.precioClienteListaId;
  return {
    items: Array.isArray(draft.items) ? draft.items.map((row) => coerceCartItemPrecioLista(row as CartItem)) : [],
    client: draft.client ?? null,
    discount: Number.isFinite(Number(draft.discount)) ? Number(draft.discount) : 0,
    formaPago: typeof draft.formaPago === 'string' && draft.formaPago.trim() ? draft.formaPago : '01',
    metodoPago: typeof draft.metodoPago === 'string' && draft.metodoPago.trim() ? draft.metodoPago : 'PUE',
    pagos: Array.isArray(draft.pagos) ? draft.pagos : [],
    notas: typeof draft.notas === 'string' ? draft.notas : '',
    transferenciaDestinoSucursalId:
      typeof draft.transferenciaDestinoSucursalId === 'string' ? draft.transferenciaDestinoSucursalId : '',
    precioClienteListaId:
      listId === 'regular' ||
      listId === 'tecnico' ||
      listId === 'mayoreo_menos' ||
      listId === 'mayoreo_mas' ||
      listId === 'cananea'
        ? listId
        : 'regular',
  };
}

export const useCartStore = create<CartState>((set, get) => ({
  // Estado inicial
  ...EMPTY_CART_DRAFT,

  // Acciones
  addItem: (product: Product, quantity: number = 1) => {
    const { items } = get();
    const existingItem = items.find((item) => item.product.id === product.id);

    if (existingItem) {
      set({
        items: items.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
        ),
      });
    } else {
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
        item.product.id === productId
          ? { ...item, precioUnitarioOverride: p, precioListaId: undefined }
          : item
      ),
    });
  },

  applyLinePrecioFromLista: (productId: string, listaId: ClientPriceListId) => {
    set({
      items: get().items.map((item) =>
        item.product.id === productId
          ? { ...item, precioUnitarioOverride: undefined, precioListaId: listaId }
          : item
      ),
    });
  },

  resetLinePrecioToTicketLista: (productId: string) => {
    set({
      items: get().items.map((item) =>
        item.product.id === productId ? { ...item, precioListaId: undefined } : item
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
    set({ ...EMPTY_CART_DRAFT });
  },

  replaceCartForOpenSaleResume: (params) => {
    set({
      items: params.items,
      client: params.client,
      discount: params.globalDiscount,
      precioClienteListaId: params.precioClienteListaId,
      formaPago: '01',
      metodoPago: 'PUE',
      pagos: [],
      notas: '',
      transferenciaDestinoSucursalId: '',
    });
  },

  replaceCartDraft: (draft) => {
    set(sanitizeCartDraft(draft));
  },

  reconcileCartProductsFromCatalog: (catalog) => {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    if (byId.size === 0) return;
    const { items } = get();
    let changed = false;
    const next = items.map((item) => {
      const fresh = byId.get(item.product.id);
      if (!fresh) return item;
      if (catalogProductSyncSignature(fresh) === catalogProductSyncSignature(item.product)) {
        return item;
      }
      changed = true;
      return { ...item, product: fresh };
    });
    if (changed) set({ items: next });
  },

  getSubtotal: () => subtotalAfterLineDiscounts(get().items, get().precioClienteListaId),

  getImpuestos: () => {
    const items = get().items;
    const listaId = get().precioClienteListaId;
    const globalPct = Number(get().discount) || 0;
    let totalIva = 0;
    for (const item of items) {
      const lineSin = lineUnitNet(item, listaId) * item.quantity;
      const lineSinAfterGlobal = lineSin * (1 - globalPct / 100);
      const imp = Number(item.product.impuesto) || 16;
      totalIva += lineSinAfterGlobal * (imp / 100);
    }
    return totalIva;
  },

  getDescuento: () => {
    const items = get().items;
    const listaId = get().precioClienteListaId;
    let lineDiscAmt = 0;
    let listaDiscAmt = 0;
    for (const item of items) {
      const q = Number(item.quantity) || 0;
      const discPct = Number(item.discount) || 0;
      const uEff = getCartLineUnitSinIvaBase(item, listaId);
      lineDiscAmt += uEff * (discPct / 100) * q;
      const o = item.precioUnitarioOverride;
      if (o == null || !Number.isFinite(Number(o))) {
        const pv = Number(item.product.precioVenta) || 0;
        const uList = getProductUnitSinIvaForClienteList(item.product, listaId);
        listaDiscAmt += (pv - uList) * (1 - discPct / 100) * q;
      }
    }
    const S0 = subtotalAfterLineDiscounts(items, listaId);
    const globalPct = Number(get().discount) || 0;
    const globalDiscAmt = S0 * (globalPct / 100);
    return lineDiscAmt + listaDiscAmt + globalDiscAmt;
  },

  getTotal: () => {
    const items = get().items;
    const listaId = get().precioClienteListaId;
    const globalPct = Number(get().discount) || 0;
    let sum = 0;
    for (const item of items) {
      const lineSin = lineUnitNet(item, listaId) * item.quantity;
      const lineSinAfterGlobal = lineSin * (1 - globalPct / 100);
      const imp = Number(item.product.impuesto) || 16;
      sum += lineSinAfterGlobal * (1 + imp / 100);
    }
    return Number.isFinite(sum) ? sum : 0;
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
