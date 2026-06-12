import type { Product, CartItem } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';
import { inferPrecioVentaSinIvaFromListas, normalizeListaPrecioValue } from '@/lib/precioListaNorm';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';

function impuestoPct(product: Product): number {
  return Number(product.impuesto) || 16;
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Lista Regular (precio mostrador): si el público con IVA redondeado a centavo termina en `.01`,
 * bajar un centavo el público y usar la base sin IVA exacta (`conIva / (1 + tasa)`).
 * Evita artefactos tipo `818.97 × 1.16 → 950.01` cuando el precio deseado es `.00`.
 * No aplica `roundMoney2` al resultado ajustado: volvería a reproducir el `.01`.
 */
function snapRegularSinIvaAvoidDotZeroOneConIva(coreSinIvaRounded: number, product: Product): number {
  if (!(coreSinIvaRounded > 0) || !Number.isFinite(coreSinIvaRounded)) return coreSinIvaRounded;
  const imp = impuestoPct(product);
  const factor = 1 + imp / 100;
  const con = roundMoney2(coreSinIvaRounded * factor);
  const cents = Math.round(con * 100) % 100;
  if (cents !== 1) return coreSinIvaRounded;
  const conAdj = roundMoney2(con - 0.01);
  if (!(conAdj > 0)) return coreSinIvaRounded;
  return conAdj / factor;
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
 * Mayor precio sin IVA entre todas las listas con importe explícito.
 * En listas Olivares/Crystal el **Regular** es siempre el más caro; si `regular` en BD quedó viejo
 * pero otra lista ya trae el precio nuevo, el POS debe mostrar el tope del escalón (p. ej. 1050 con IVA).
 */
function maxExplicitListaSinIvaLadderTop(product: Product): number {
  let m = 0;
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const ex = normalizeListaPrecioValue(product.preciosPorListaCliente?.[id]);
    if (ex !== undefined && ex > 0) {
      const s = explicitListaToSinIva(product, ex);
      if (s > m) m = s;
    }
  }
  return m;
}

/**
 * Precio unitario sin IVA de la lista **Regular**.
 * Preferencia: el **más caro** entre los importes fijos de todas las listas (escalón tope = Regular de negocio),
 * frente a `precioVenta` del documento, para tolerar catálogos desalineados tras importaciones parciales.
 */
function getRegularUnitSinIva(product: Product): number {
  const pctReg = getListaPrecioClientePct('regular');
  const pvBase = Number(product.precioVenta) || 0;
  const fromPv = pvBase * (1 - pctReg / 100);
  const ladderTop = maxExplicitListaSinIvaLadderTop(product);

  let core = 0;
  if (ladderTop > 0 && fromPv > 0.005) {
    core = Math.max(ladderTop, fromPv);
  } else if (ladderTop > 0) {
    core = ladderTop;
  } else if (fromPv > 0.005) {
    core = fromPv;
  }

  if (core > 0) {
    return snapRegularSinIvaAvoidDotZeroOneConIva(roundMoney2(core), product);
  }

  const alt = firstSinIvaFromAnyLista(product);
  if (alt > 0) {
    return snapRegularSinIvaAvoidDotZeroOneConIva(roundMoney2(alt * (1 - pctReg / 100)), product);
  }
  return 0;
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
 * A partir del importe Regular (mismo modo que el formulario: con o sin IVA),
 * calcula el resto de listas con los % de configuración del POS.
 */
export function deriveListaPrecioStringsFromRegularAmount(regularAmount: number): Record<ClientPriceListId, string> {
  const out = {} as Record<ClientPriceListId, string>;
  for (const id of CLIENT_PRICE_LIST_ORDER) out[id] = '';
  if (!Number.isFinite(regularAmount) || regularAmount < 0) return out;

  const reg = roundMoney2(regularAmount);
  out.regular = reg.toFixed(2);
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    if (id === 'regular') continue;
    const pct = getListaPrecioClientePct(id);
    out[id] = roundMoney2(reg * (1 - pct / 100)).toFixed(2);
  }
  return out;
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
