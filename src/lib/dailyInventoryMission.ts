import type { Product } from '@/types';

/** Cantidad fija de artículos a revisar por día y por usuario. */
export const MISION_INVENTARIO_DIARIO = 45;

const STORAGE_PREFIX = 'servipos_mision_inv_v1';

function storageKey(userId: string, dateKey: string): string {
  return `${STORAGE_PREFIX}_${userId}_${dateKey}`;
}

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Elige de forma determinista `count` IDs entre los dados (misma lista el mismo día para el mismo usuario).
 */
export function pickDailyMissionProductIds(
  productIds: string[],
  userId: string,
  dateKey: string,
  count: number
): string[] {
  const sorted = [...new Set(productIds)].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return [];
  const n = Math.min(count, sorted.length);
  if (sorted.length <= n) return sorted;

  const rng = mulberry32(hashStringToSeed(`${dateKey}|${userId}|mision-inv-v1`));
  const idx = sorted.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => sorted[i]!);
}

export function pickDailyMissionProducts(
  products: Product[],
  userId: string,
  dateKey: string,
  count: number
): Product[] {
  const active = products.filter((p) => p.activo !== false);
  const ids = pickDailyMissionProductIds(
    active.map((p) => p.id),
    userId,
    dateKey,
    count
  );
  const map = new Map(active.map((p) => [p.id, p]));
  return ids
    .map((id) => map.get(id))
    .filter((p): p is Product => p != null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function loadMissionDoneIds(userId: string, dateKey: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKey(userId, dateKey));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function saveMissionDoneIds(userId: string, dateKey: string, done: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId, dateKey), JSON.stringify([...done]));
  } catch {
    /* ignore quota */
  }
}
