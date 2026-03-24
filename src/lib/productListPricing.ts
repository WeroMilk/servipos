import type { Product, CartItem } from '@/types';
import type { ClientPriceListId } from '@/lib/clientPriceLists';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';

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
