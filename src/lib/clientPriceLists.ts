// Listas "Precios por cliente" en POS (descuentos configurables por admin).
// Las 5 listas base son fijas; listas adicionales se definen en Configuración → Inventario.

export const BUILTIN_CLIENT_PRICE_LIST_ORDER = [
  'regular',
  'tecnico',
  'mayoreo_menos',
  'mayoreo_mas',
  'cananea',
] as const;

/** Alias histórico: solo las 5 listas integradas. Para UI use `useClientPriceListCatalog()`. */
export const CLIENT_PRICE_LIST_ORDER = BUILTIN_CLIENT_PRICE_LIST_ORDER;

export type BuiltinClientPriceListId = (typeof BUILTIN_CLIENT_PRICE_LIST_ORDER)[number];

/** Id de lista (integrada o extra configurada en sucursal). */
export type ClientPriceListId = string;

export function normalizeClientPriceListId(raw: unknown): ClientPriceListId {
  if (typeof raw === 'string' && (BUILTIN_CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(raw)) {
    return raw;
  }
  return 'regular';
}

export const CLIENT_PRICE_LABELS: Record<BuiltinClientPriceListId, string> = {
  regular: 'Regular',
  tecnico: 'Tecnico',
  mayoreo_menos: 'Mayoreo -',
  mayoreo_mas: 'Mayoreo +',
  cananea: 'Cananea',
};

export const DEFAULT_CLIENT_PRICE_DISCOUNTS: Record<BuiltinClientPriceListId, number> = {
  regular: 0,
  tecnico: 5,
  mayoreo_menos: 8,
  mayoreo_mas: 12,
  cananea: 15,
};

/** PIN para que cajeros editen precio unitario en carrito (admin no lo usa). */
export const POS_EDIT_UNIT_PRICE_PIN = '1234';
