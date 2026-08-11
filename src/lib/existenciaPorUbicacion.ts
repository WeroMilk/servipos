import { MUEBLE_LETRAS } from '@/data/ubicacionesMuebleA';

const KNOWN_UBICACION_BY_UPPER = new Map(
  MUEBLE_LETRAS.map((letra) => [letra.trim().toUpperCase(), letra] as const)
);

/** Normaliza la clave de ubicación al casing canónico de `MUEBLE_LETRAS` cuando existe. */
export function normalizeUbicacionKey(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  return KNOWN_UBICACION_BY_UPPER.get(t.toUpperCase()) ?? t;
}

/** Etiqueta legible para el desglose de inventario. */
export function labelUbicacionInventario(ubicacion: string): string {
  const key = normalizeUbicacionKey(ubicacion);
  const upper = key.toUpperCase();
  if (upper === 'MOSTRADOR') return 'mostrador';
  if (upper === 'BANDAS') return 'BANDAS';
  if (upper === 'CAJONERA') return 'cajonera';
  if (upper === 'BODEGA') return 'bodega';
  return `mueble ${key}`;
}

export function parseExistenciaPorUbicacion(raw: unknown): Record<string, number> | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeUbicacionKey(k);
    if (!key) continue;
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sumExistenciaPorUbicacion(
  map: Record<string, number> | null | undefined
): number {
  if (!map) return 0;
  let total = 0;
  for (const v of Object.values(map)) {
    const n = Math.trunc(Number(v));
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/** Actualiza la cantidad en una ubicación; omite claves con 0. */
export function mergeExistenciaEnUbicacion(
  prev: Record<string, number> | null | undefined,
  ubicacion: string,
  cantidad: number
): Record<string, number> {
  const key = normalizeUbicacionKey(ubicacion);
  const qty = Math.max(0, Math.trunc(Number(cantidad) || 0));
  const next: Record<string, number> = { ...(prev ?? {}) };
  if (!key) return next;
  if (qty <= 0) delete next[key];
  else next[key] = qty;
  return next;
}

export function qtyEnUbicacion(
  map: Record<string, number> | null | undefined,
  ubicacion: string
): number {
  const key = normalizeUbicacionKey(ubicacion);
  if (!key || !map) return 0;
  const n = Math.trunc(Number(map[key]));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Entradas ordenadas para UI (especiales primero, luego alfabético). */
export function entriesExistenciaPorUbicacion(
  map: Record<string, number> | null | undefined
): { ubicacion: string; cantidad: number; label: string }[] {
  if (!map) return [];
  const order = new Map(MUEBLE_LETRAS.map((l, i) => [l, i] as const));
  return Object.entries(map)
    .map(([ubicacion, cantidad]) => ({
      ubicacion,
      cantidad: Math.trunc(Number(cantidad)) || 0,
      label: labelUbicacionInventario(ubicacion),
    }))
    .filter((x) => x.cantidad > 0)
    .sort((a, b) => {
      const ia = order.get(a.ubicacion) ?? 9999;
      const ib = order.get(b.ubicacion) ?? 9999;
      if (ia !== ib) return ia - ib;
      return a.ubicacion.localeCompare(b.ubicacion, 'es');
    });
}
