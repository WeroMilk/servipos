import type { Product } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';

/**
 * Unifica valores numéricos (Firestore, CSV, Excel) para mapas `preciosPorListaCliente`.
 */
export function normalizeListaPrecioValue(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) return n;
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
  const out: Partial<Record<ClientPriceListId, number>> = {};
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const n = normalizeListaPrecioValue(o[id]);
    if (n !== undefined) out[id] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
