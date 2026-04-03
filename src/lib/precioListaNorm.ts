import type { Product } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Convierte precio desde Firestore / Excel / CSV (coma decimal, miles con coma o punto).
 * Evita que `Number("1,234.56")` o `Number("1.234,56")` den NaN y el catálogo muestre $0.
 */
export function parsePrecioNumberFromFirestore(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    let s = value.trim().replace(/\s/g, '');
    if (!s) return 0;
    s = s.replace(/^\$/, '').replace(/MXN$/i, '').trim();
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let normalized: string;
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      normalized = s.replace(/,/g, '');
    } else {
      normalized = s.replace(',', '.');
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Unifica valores numéricos (Firestore, CSV, Excel) para mapas `preciosPorListaCliente`.
 */
export function normalizeListaPrecioValue(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    const n = parsePrecioNumberFromFirestore(v);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
  }
  return undefined;
}

/**
 * Mapa con claves insensibles a mayúsculas (p. ej. `Regular` → `regular`).
 */
function recordWithCaseInsensitiveKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = k.toLowerCase().trim();
    if (!(nk in out) || out[nk] == null) out[nk] = v;
  }
  return out;
}

/** Parsea el documento Firestore / IndexedDB al tipo `preciosPorListaCliente`. */
export function parsePreciosPorListaClienteRaw(raw: unknown): Product['preciosPorListaCliente'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = recordWithCaseInsensitiveKeys(raw as Record<string, unknown>);
  const known = new Set<string>(CLIENT_PRICE_LIST_ORDER as unknown as string[]);
  const out: Partial<Record<ClientPriceListId, number>> = {};
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const n = normalizeListaPrecioValue(o[id]);
    if (n !== undefined) out[id] = n;
  }
  let fallbackPositive: number | undefined;
  for (const [k, v] of Object.entries(o)) {
    const kid = k.toLowerCase().trim();
    if (known.has(kid)) continue;
    const n = normalizeListaPrecioValue(v);
    if (n !== undefined && n > 0) {
      if (fallbackPositive === undefined) fallbackPositive = n;
    }
  }
  const reg = out.regular;
  if ((reg === undefined || reg <= 0) && fallbackPositive !== undefined && fallbackPositive > 0) {
    out.regular = fallbackPositive;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Primera lista con importe > 0 convertida a sin IVA (coherente con flags del documento).
 * Usado al hidratar producto y en `productListPricing`.
 */
export function firstSinIvaFromListaMap(
  map: NonNullable<Product['preciosPorListaCliente']>,
  listaImportesConIva: boolean,
  impuestoPct: number
): number {
  const imp = Number(impuestoPct) || 16;
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const ex = normalizeListaPrecioValue(map[id]);
    if (ex !== undefined && ex > 0) {
      return listaImportesConIva ? ex / (1 + imp / 100) : ex;
    }
  }
  return 0;
}

/**
 * Si `precioVenta` en documento es 0 pero hay precio en listas, obtiene base sin IVA para el catálogo.
 * Alineado con defaults de `preciosListaIncluyenIva` en documento (sin leer config fiscal global).
 */
export function resolvePrecioVentaSinIvaForDoc(args: {
  rawPv: unknown;
  preciosPorListaCliente: Product['preciosPorListaCliente'];
  preciosListaIncluyenIva: boolean | undefined;
  impuesto: number;
}): number {
  const pv0 = parsePrecioNumberFromFirestore(args.rawPv);
  if (pv0 > 0) return roundMoney2(pv0);
  const map = args.preciosPorListaCliente;
  if (!map) return 0;
  const listaImportesConIva =
    args.preciosListaIncluyenIva === true
      ? true
      : args.preciosListaIncluyenIva === false
        ? false
        : true;
  const sinIva = firstSinIvaFromListaMap(map, listaImportesConIva, args.impuesto);
  return roundMoney2(sinIva);
}
