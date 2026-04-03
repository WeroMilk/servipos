import type { Product, CartItem } from '@/types';
import { type ClientPriceListId } from '@/lib/clientPriceLists';
import { firstSinIvaFromListaMap, normalizeListaPrecioValue } from '@/lib/precioListaNorm';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';

function impuestoPct(product: Product): number {
  return Number(product.impuesto) || 16;
}

/** Primera lista con importe > 0 (sin IVA), para cuando `precioVenta` es 0. */
function firstSinIvaFromAnyLista(product: Product): number {
  const map = product.preciosPorListaCliente;
  if (!map) return 0;
  return firstSinIvaFromListaMap(map, effectiveListaPreciosIncluyenIva(product), impuestoPct(product));
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
  if (explicit !== undefined && explicit > 0) {
    if (effectiveListaPreciosIncluyenIva(product)) {
      const imp = impuestoPct(product);
      return explicit / (1 + imp / 100);
    }
    return explicit;
  }
  const base = Number(product.precioVenta) || 0;
  const pct = getListaPrecioClientePct(listaId);
  let sinIva = base * (1 - pct / 100);
  if (sinIva <= 0) {
    const alt = firstSinIvaFromAnyLista(product);
    if (alt > 0) sinIva = alt * (1 - pct / 100);
  }
  return sinIva;
}

/** Unitario sin IVA antes del descuento de línea (override manual gana sobre lista). */
export function getCartLineUnitSinIvaBase(item: CartItem, listaId: ClientPriceListId): number {
  const o = item.precioUnitarioOverride;
  if (o != null && Number.isFinite(Number(o))) return Number(o);
  return getProductUnitSinIvaForClienteList(item.product, listaId);
}
