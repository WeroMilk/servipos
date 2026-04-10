import type { Product, CartItem } from '@/types';
import { type ClientPriceListId } from '@/lib/clientPriceLists';
import { inferPrecioVentaSinIvaFromListas, normalizeListaPrecioValue } from '@/lib/precioListaNorm';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';

function impuestoPct(product: Product): number {
  return Number(product.impuesto) || 16;
}

/** Convierte importe fijo de lista (según bandera IVA del producto) a unitario sin IVA. */
function explicitListaToSinIva(product: Product, explicit: number): number {
  if (effectiveListaPreciosIncluyenIva(product)) {
    const imp = impuestoPct(product);
    return explicit / (1 + imp / 100);
  }
  return explicit;
}

/**
 * Precio unitario sin IVA de la lista **Regular** (referencia para comparar otras listas).
 */
function getRegularUnitSinIva(product: Product): number {
  const explicit = normalizeListaPrecioValue(product.preciosPorListaCliente?.regular);
  if (explicit !== undefined && explicit > 0) {
    return explicitListaToSinIva(product, explicit);
  }
  const base = Number(product.precioVenta) || 0;
  const pctReg = getListaPrecioClientePct('regular');
  let sinIva = base * (1 - pctReg / 100);
  if (sinIva <= 0) {
    const alt = firstSinIvaFromAnyLista(product);
    if (alt > 0) sinIva = alt * (1 - pctReg / 100);
  }
  return sinIva;
}

/** Primera lista con importe > 0 (sin IVA), para cuando `precioVenta` es 0. */
function firstSinIvaFromAnyLista(product: Product): number {
  const map = product.preciosPorListaCliente;
  if (!map) return 0;
  return inferPrecioVentaSinIvaFromListas(map, effectiveListaPreciosIncluyenIva(product), impuestoPct(product));
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
    const unitSin = explicitListaToSinIva(product, explicit);
    /**
     * Si el catálogo trae el mismo importe en Técnico (u otra lista) que en Regular — p. ej. merge RTF
     * con precios duplicados — el usuario espera el **% de lista** (Configuración) sobre Regular,
     * no un segundo precio idéntico.
     */
    if (listaId !== 'regular') {
      const regRef = getRegularUnitSinIva(product);
      if (regRef > 0 && Math.abs(unitSin - regRef) < 0.02) {
        const pct = getListaPrecioClientePct(listaId);
        return regRef * (1 - pct / 100);
      }
    }
    return unitSin;
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

/** Unitario sin IVA antes del descuento de línea (override manual gana; luego lista por línea o la del ticket). */
export function getCartLineUnitSinIvaBase(item: CartItem, listaIdTicket: ClientPriceListId): number {
  const o = item.precioUnitarioOverride;
  if (o != null && Number.isFinite(Number(o))) return Number(o);
  const listaLinea = item.precioListaId ?? listaIdTicket;
  return getProductUnitSinIvaForClienteList(item.product, listaLinea);
}
