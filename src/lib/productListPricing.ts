import type { Product, CartItem } from '@/types';
import { type ClientPriceListId } from '@/lib/clientPriceLists';
import { inferPrecioVentaSinIvaFromListas, normalizeListaPrecioValue } from '@/lib/precioListaNorm';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';

function impuestoPct(product: Product): number {
  return Number(product.impuesto) || 16;
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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
 * Si hay precio fijo en `preciosPorListaCliente.regular` **y** `precioVenta` en catálogo, se usa el **mayor**:
 * corrige legado donde en “Regular” quedó el importe de otra lista (p. ej. $180 de mayoreo-) mientras
 * `precioVenta` sigue siendo el de mostrador ($250 con IVA).
 */
function getRegularUnitSinIva(product: Product): number {
  const explicit = normalizeListaPrecioValue(product.preciosPorListaCliente?.regular);
  const exSin =
    explicit !== undefined && explicit > 0 ? explicitListaToSinIva(product, explicit) : 0;
  const pvBase = Number(product.precioVenta) || 0;
  const pctReg = getListaPrecioClientePct('regular');
  const fromPv = pvBase * (1 - pctReg / 100);
  const listaFloor = maxExplicitListaSinIvaRegularFloor(product);

  let core = 0;
  if (exSin > 0 && fromPv > 0.005) {
    core = Math.max(exSin, fromPv, listaFloor);
  } else if (exSin > 0) {
    core = Math.max(exSin, listaFloor);
  } else if (fromPv > 0.005) {
    core = Math.max(fromPv, listaFloor);
  } else if (listaFloor > 0) {
    core = listaFloor;
  }

  if (core > 0) {
    return roundMoney2(core);
  }

  const alt = firstSinIvaFromAnyLista(product);
  if (alt > 0) {
    return roundMoney2(alt * (1 - pctReg / 100));
  }
  return 0;
}

/** Primera lista con importe > 0 (sin IVA), para cuando `precioVenta` es 0. */
function firstSinIvaFromAnyLista(product: Product): number {
  const map = product.preciosPorListaCliente;
  if (!map) return 0;
  return inferPrecioVentaSinIvaFromListas(map, effectiveListaPreciosIncluyenIva(product), impuestoPct(product));
}

/** Mayor precio sin IVA entre listas que deben ser ≤ Regular (excluye cañanea). */
function maxExplicitListaSinIvaRegularFloor(product: Product): number {
  const ids = ['tecnico', 'mayoreo_mas', 'mayoreo_menos'] as const;
  let m = 0;
  for (const id of ids) {
    const ex = normalizeListaPrecioValue(product.preciosPorListaCliente?.[id]);
    if (ex !== undefined && ex > 0) {
      const s = explicitListaToSinIva(product, ex);
      if (s > m) m = s;
    }
  }
  return m;
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
  if (listaId === 'regular') {
    return getRegularUnitSinIva(product);
  }

  const explicit = normalizeListaPrecioValue(product.preciosPorListaCliente?.[listaId]);
  if (explicit !== undefined && explicit > 0) {
    const unitSin = explicitListaToSinIva(product, explicit);
    /**
     * Si el catálogo trae el mismo importe en Técnico (u otra lista) que en Regular — p. ej. merge RTF
     * con precios duplicados — el usuario espera el **% de lista** (Configuración) sobre Regular,
     * no un segundo precio idéntico.
     */
    const regRef = getRegularUnitSinIva(product);
    if (regRef > 0 && Math.abs(unitSin - regRef) < 0.02) {
      const pct = getListaPrecioClientePct(listaId);
      return regRef * (1 - pct / 100);
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
