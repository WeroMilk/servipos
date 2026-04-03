import type { Product, CartItem } from '@/types';
import type { ClientPriceListId } from '@/lib/clientPriceLists';
import { normalizeListaPrecioValue } from '@/lib/precioListaNorm';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';

function impuestoPct(product: Product): number {
  return Number(product.impuesto) || 16;
}

/**
 * Precio al público (con IVA) según lista; base interna sigue siendo sin IVA para totales y CFDI.
 */
export function getProductUnitConIvaForClienteList(
  product: Product,
  listaId: ClientPriceListId
): number {
  const sinIva = getProductUnitSinIvaForClienteList(product, listaId);
  const imp = impuestoPct(product);
  return sinIva * (1 + imp / 100);
}

/**
 * Importe de IVA por unidad (sin descuento de línea), coherente con el precio catálogo.
 */
export function getProductIvaUnitarioDesdeSinIva(product: Product, unitSinIva: number): number {
  const imp = impuestoPct(product);
  return unitSinIva * (imp / 100);
}

/** Precio lista Regular mostrado al público (con IVA). */
export function getProductPrecioPublicoRegular(product: Product): number {
  return getProductUnitConIvaForClienteList(product, 'regular');
}

/**
 * Precio unitario sin IVA según lista de cliente (o % configurado si no hay precio fijo por producto).
 * Si `preciosListaIncluyenIva` aplica, los importes fijos por lista vienen con IVA y se convierten aquí.
 */
export function getProductUnitSinIvaForClienteList(
  product: Product,
  listaId: ClientPriceListId
): number {
  const explicit = normalizeListaPrecioValue(product.preciosPorListaCliente?.[listaId]);
  if (explicit !== undefined) {
    if (effectiveListaPreciosIncluyenIva(product)) {
      const imp = impuestoPct(product);
      return explicit / (1 + imp / 100);
    }
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
