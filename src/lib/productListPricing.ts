import type { Product, CartItem } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';

/**
 * Precio de catálogo sin IVA para listados (Inventario, etc.):
 * usa `precioVenta` si es > 0; si no, lista `regular` explícita o el mayor entre listas guardadas.
 * Así no se muestra $0 cuando solo existían precios por lista.
 */
export function getProductPrecioBaseCatalogoSinIva(product: Product): number {
  const pv = Number(product.precioVenta) || 0;
  if (pv > 0) return pv;
  const raw = product.preciosPorListaCliente;
  if (!raw || typeof raw !== 'object') return 0;
  const reg = raw.regular;
  if (reg != null && Number.isFinite(reg) && reg >= 0) return reg;
  let max = 0;
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const v = raw[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v > max) max = v;
  }
  return max;
}

/**
 * Precio unitario sin IVA según lista de cliente (o % configurado si no hay precio fijo por producto).
 */
export function getProductUnitSinIvaForClienteList(
  product: Product,
  listaId: ClientPriceListId
): number {
  const explicit = product.preciosPorListaCliente?.[listaId];
  if (explicit != null && Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const base = Number(product.precioVenta) || 0;
  const pct = getListaPrecioClientePct(listaId);
  return base * (1 - pct / 100);
}

/** Unitario sin IVA antes del descuento de línea (override manual gana sobre lista). */
export function getCartLineUnitSinIvaBase(item: CartItem, listaId: ClientPriceListId): number {
  const o = item.precioUnitarioOverride;
  if (o != null && Number.isFinite(Number(o))) return Number(o);
  return getProductUnitSinIvaForClienteList(item.product, listaId);
}
