// Listas "Precios por cliente" en POS (descuentos configurables por admin).

export const CLIENT_PRICE_LIST_ORDER = [
  'regular',
  'tecnico',
  'mayoreo_menos',
  'mayoreo_mas',
  'cananea',
] as const;

export type ClientPriceListId = (typeof CLIENT_PRICE_LIST_ORDER)[number];

export const CLIENT_PRICE_LABELS: Record<ClientPriceListId, string> = {
  regular: 'Regular',
  tecnico: 'Tecnico',
  mayoreo_menos: 'Mayoreo -',
  mayoreo_mas: 'Mayoreo +',
  cananea: 'Cananea',
};

export const DEFAULT_CLIENT_PRICE_DISCOUNTS: Record<ClientPriceListId, number> = {
  regular: 0,
  tecnico: 5,
  mayoreo_menos: 8,
  mayoreo_mas: 12,
  cananea: 15,
};

/** PIN para que cajeros editen precio unitario en carrito (admin no lo usa). */
export const POS_EDIT_UNIT_PRICE_PIN = '1234';
