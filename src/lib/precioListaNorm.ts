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
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if ('value' in o && typeof o.value === 'number' && Number.isFinite(o.value)) return o.value;
    if ('value' in o && typeof o.value === 'string') return parsePrecioNumberFromFirestore(o.value);
    if (typeof o.toNumber === 'function') {
      try {
        const n = (o as { toNumber: () => number }).toNumber();
        if (typeof n === 'number' && Number.isFinite(n)) return n;
      } catch {
        /* ignore */
      }
    }
  }
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

/** Clave normalizada para emparejar nombres de campo con distinta capitalización / separadores. */
function normFieldKey(k: string): string {
  return k
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
}

function buildFieldIndex(d: Record<string, unknown>): Map<string, unknown> {
  const idx = new Map<string, unknown>();
  for (const [k, v] of Object.entries(d)) {
    const nk = normFieldKey(k);
    if (!idx.has(nk)) idx.set(nk, v);
  }
  return idx;
}

function pickByKeyOrder(idx: Map<string, unknown>, orderedKeys: string[]): unknown[] {
  const out: unknown[] = [];
  for (const k of orderedKeys) {
    const v = idx.get(normFieldKey(k));
    if (v !== undefined && v !== null && v !== '') out.push(v);
  }
  return out;
}

function isEmptyPrecioRaw(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/**
 * Valores candidatos a precio de venta (sin IVA) en un documento Firestore / importación.
 * Orden: campos canónicos primero, luego alias; incluye `precios` anidado y la cadena legacy del listener.
 */
function collectPrecioVentaRawCandidates(d: Record<string, unknown>): unknown[] {
  const idx = buildFieldIndex(d);
  const out: unknown[] = [];
  const push = (v: unknown) => {
    if (isEmptyPrecioRaw(v)) return;
    out.push(v);
  };
  for (const v of pickByKeyOrder(idx, [
    'precioVenta',
    'precioVentaSinIva',
    'precio_sin_iva',
    'precioSinIva',
    'precioPublico',
    'precioLista',
    'precio_lista',
    'precioUnitario',
    'precio_unitario',
    'precioUnitarioVenta',
    'pvp',
    'PVP',
    'precioMostrador',
    'precio',
  ])) {
    push(v);
  }

  const nestedRaw = d.precios ?? d.Precios;
  if (nestedRaw && typeof nestedRaw === 'object' && nestedRaw !== null && !Array.isArray(nestedRaw)) {
    const nidx = buildFieldIndex(nestedRaw as Record<string, unknown>);
    for (const v of pickByKeyOrder(nidx, [
      'precioVenta',
      'venta',
      'regular',
      'publico',
      'precioPublico',
      'precio',
      'lista',
    ])) {
      push(v);
    }
  }

  for (const v of [
    d.precioVenta,
    d.precio,
    d.precioPublico,
    d.precio_venta,
    d.pvp,
    d.PVP,
    d.precioMostrador,
    d.precio_unitario,
    d.importe,
  ]) {
    push(v);
  }

  return out;
}

/**
 * Elige el mejor `raw` para `precioVenta`: si hay varios campos, preferir el que parsea a un importe &gt; 0
 * (evita quedarse en `precioVenta: 0` cuando `precio` u otro alias sí trae el importe).
 */
export function pickBestPrecioVentaRawFromFirestoreDoc(d: Record<string, unknown>): unknown {
  const candidates = collectPrecioVentaRawCandidates(d);
  for (const c of candidates) {
    if (parsePrecioNumberFromFirestore(c) > 0) return c;
  }
  for (const c of candidates) {
    if (!isEmptyPrecioRaw(c)) return c;
  }
  return undefined;
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

/** Normaliza clave humana / Excel / legado para emparejar alias de listas. */
function normListaAliasKey(rawKey: string): string {
  return rawKey
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}+.-]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Alias → id canónico (`CLIENT_PRICE_LIST_ORDER`).
 * Incluye variantes de importación y mayoreo + / −.
 */
const LISTA_ALIAS_TO_CANONICAL: Record<string, ClientPriceListId> = {
  lista: 'regular',
  publico: 'regular',
  general: 'regular',
  mostrador: 'regular',
  tec: 'tecnico',
  tecnica: 'tecnico',
  mayoremenos: 'mayoreo_menos',
  'mayoreo menos': 'mayoreo_menos',
  'mayoreo-': 'mayoreo_menos',
  'mayoreo -': 'mayoreo_menos',
  'm -': 'mayoreo_menos',
  'm-': 'mayoreo_menos',
  'mayoreo bajo': 'mayoreo_menos',
  'mayoreo menor': 'mayoreo_menos',
  mayoreomas: 'mayoreo_mas',
  'mayoreo mas': 'mayoreo_mas',
  'mayoreo+': 'mayoreo_mas',
  'mayoreo +': 'mayoreo_mas',
  'm +': 'mayoreo_mas',
  'm+': 'mayoreo_mas',
  'mayoreo alto': 'mayoreo_mas',
  'mayoreo mayor': 'mayoreo_mas',
  'mayoreo plus': 'mayoreo_mas',
  cananeas: 'cananea',
  cananea: 'cananea',
};

function resolveKeyToListaId(rawKey: string): ClientPriceListId | undefined {
  const spaced = rawKey.toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const underscored = spaced.replace(/ /g, '_');
  if ((CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(underscored)) {
    return underscored as ClientPriceListId;
  }
  const n = normListaAliasKey(rawKey);
  const compact = n.replace(/\s/g, '');
  return LISTA_ALIAS_TO_CANONICAL[n] ?? LISTA_ALIAS_TO_CANONICAL[compact];
}

/**
 * Une varias fuentes (p. ej. `doc.precios` anidado + `doc.preciosPorListaCliente`).
 * Las fuentes posteriores pisan a las anteriores. Solo entran claves que corresponden a una lista conocida.
 */
export function coalescePreciosPorListaClienteInputs(...sources: unknown[]): Record<string, unknown> | undefined {
  const acc: Partial<Record<ClientPriceListId, unknown>> = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const o = recordWithCaseInsensitiveKeys(src as Record<string, unknown>);
    for (const [k, v] of Object.entries(o)) {
      const id = resolveKeyToListaId(k);
      if (!id) continue;
      acc[id] = v;
    }
  }
  return Object.keys(acc).length > 0 ? (acc as Record<string, unknown>) : undefined;
}

/** Parsea el documento Firestore / IndexedDB al tipo `preciosPorListaCliente`. */
export function parsePreciosPorListaClienteRaw(raw: unknown): Product['preciosPorListaCliente'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = recordWithCaseInsensitiveKeys(raw as Record<string, unknown>);
  const out: Partial<Record<ClientPriceListId, number>> = {};

  for (const id of CLIENT_PRICE_LIST_ORDER) {
    let picked: unknown = o[id];
    if (picked === undefined || picked === null) {
      for (const [k, v] of Object.entries(o)) {
        if (resolveKeyToListaId(k) === id) {
          picked = v;
          break;
        }
      }
    }
    const n = normalizeListaPrecioValue(picked);
    if (n !== undefined) out[id] = n;
  }

  const orphanValues: number[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (resolveKeyToListaId(k)) continue;
    const n = normalizeListaPrecioValue(v);
    if (n !== undefined && n > 0) orphanValues.push(roundMoney2(n));
  }
  const reg = out.regular;
  if ((reg === undefined || reg <= 0) && orphanValues.length === 1) {
    out.regular = orphanValues[0]!;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function listaExplicitToSinIva(
  ex: number,
  listaImportesConIva: boolean,
  impuestoPct: number
): number {
  const imp = Number(impuestoPct) || 16;
  return listaImportesConIva ? ex / (1 + imp / 100) : ex;
}

/**
 * Primera lista con importe > 0 convertida a sin IVA (coherente con flags del documento).
 * @deprecated Prefer `inferPrecioVentaSinIvaFromListas` para no tomar por error una lista barata (p. ej. mayoreo- antes que regular).
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
 * Base sin IVA inferida desde listas: prioriza **regular** si existe; si no, el **mayor** importe entre listas
 * (evita usar mayoreo-/cañanea como “precio de catálogo” solo por ir antes en el orden).
 */
export function inferPrecioVentaSinIvaFromListas(
  map: NonNullable<Product['preciosPorListaCliente']>,
  listaImportesConIva: boolean,
  impuestoPct: number
): number {
  const explicitReg = normalizeListaPrecioValue(map.regular);
  if (explicitReg !== undefined && explicitReg > 0) {
    return roundMoney2(listaExplicitToSinIva(explicitReg, listaImportesConIva, impuestoPct));
  }
  let best = 0;
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    if (id === 'regular') continue;
    const ex = normalizeListaPrecioValue(map[id]);
    if (ex !== undefined && ex > 0) {
      const s = listaExplicitToSinIva(ex, listaImportesConIva, impuestoPct);
      if (s > best) best = s;
    }
  }
  return roundMoney2(best);
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
  const map = args.preciosPorListaCliente;
  const listaImportesConIva =
    args.preciosListaIncluyenIva === true
      ? true
      : args.preciosListaIncluyenIva === false
        ? false
        : true;
  const pv0 = parsePrecioNumberFromFirestore(args.rawPv);
  const fromListas =
    map ? inferPrecioVentaSinIvaFromListas(map, listaImportesConIva, args.impuesto) : 0;

  if (pv0 > 0) {
    const regEx = map ? normalizeListaPrecioValue(map.regular) : undefined;
    if (regEx !== undefined && regEx > 0) {
      const regSin = listaExplicitToSinIva(regEx, listaImportesConIva, args.impuesto);
      if (regSin > pv0 + 0.02) {
        return roundMoney2(regSin);
      }
    } else if (map && fromListas > pv0 + 0.02) {
      /** Sin `regular` explícita: subir PV si solo reflejaba una lista barata y hay otras listas mayores. */
      return roundMoney2(fromListas);
    }
    return roundMoney2(pv0);
  }
  return fromListas;
}
