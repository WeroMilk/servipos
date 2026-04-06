import type { Product } from '@/types';
import {
  addDaysToMexicoDateKey,
  effectiveDateKeyForMissionPartition,
  getBimonthCycleInfo,
} from '@/lib/quincenaMx';

const STORAGE_PREFIX = 'servipos_mision_inv_v1';

/** Clave de partición activa: la misma lista se conserva entre días hasta completarla o pedir otra misión. */
const ACTIVE_PARTITION_PREFIX = 'servipos_mision_inv_active_partition_v1';

function activePartitionStorageKey(userId: string): string {
  return `${ACTIVE_PARTITION_PREFIX}_${userId}`;
}

export function loadActiveMissionPartitionKey(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(activePartitionStorageKey(userId));
    if (!raw || !raw.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

export function saveActiveMissionPartitionKey(userId: string, partitionKey: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(activePartitionStorageKey(userId), partitionKey);
  } catch {
    /* quota */
  }
}

/**
 * Resuelve la partición de almacenamiento para la misión actual: no cambia solo por pasar de día;
 * si hay lista incompleta (o completada esperando "otra misión"), se reutiliza la misma clave.
 */
export function resolveStickyMissionPartitionKey(
  userId: string,
  products: Product[],
  todayDateKey: string
): string {
  const activeIds = new Set(products.filter((p) => p.activo !== false).map((p) => p.id));
  const pickValid = (ids: string[] | null): string[] =>
    ids ? ids.filter((id) => activeIds.has(id)) : [];
  const effectiveToday = effectiveDateKeyForMissionPartition(todayDateKey);

  const active = loadActiveMissionPartitionKey(userId);
  if (active) {
    const valid = pickValid(loadMissionProductIds(userId, active));
    if (valid.length > 0) {
      return active;
    }
  }

  const legacy = pickValid(loadMissionProductIds(userId, effectiveToday));
  if (legacy.length > 0) {
    saveActiveMissionPartitionKey(userId, effectiveToday);
    return effectiveToday;
  }

  saveActiveMissionPartitionKey(userId, effectiveToday);
  return effectiveToday;
}

/** Nueva partición al pedir otra misión (evita pisar la lista/done del bloque anterior el mismo día). */
export function newMissionPartitionKeyAfterComplete(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `m${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(userId: string, dateKey: string): string {
  return `${STORAGE_PREFIX}_${userId}_${dateKey}`;
}

function listKey(userId: string, dateKey: string): string {
  return `${STORAGE_PREFIX}_list_v2_${userId}_${dateKey}`;
}

function usedKey(userId: string, dateKey: string): string {
  return `${STORAGE_PREFIX}_used_v2_${userId}_${dateKey}`;
}

/** Misión por defecto: 45 artículos aleatorios. */
export const DEFAULT_MISSION_SIZE = 45;
export const MIN_MISSION_SIZE = 5;
export const MAX_MISSION_SIZE = 50;

function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baraja determinística (misma semilla = mismo orden). */
export function shuffleIdsWithSeed(ids: string[], seed: string): string[] {
  const arr = [...ids];
  const rng = mulberry32(hashStringToSeed(seed));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Elige hasta `count` artículos aleatorios sin repetir dentro de la selección.
 * `exclude`: IDs ya incluidos en misiones anteriores del mismo día; si el conjunto agota el catálogo, se vuelve a elegir entre todos los activos.
 */
export function pickRandomMissionIdsFromProducts(
  products: Product[],
  count: number,
  exclude: Set<string>,
  seed: string
): string[] {
  const active = products.filter((p) => p.activo !== false);
  let pool = active.map((p) => p.id).filter((id) => !exclude.has(id));
  if (pool.length === 0) {
    pool = active.map((p) => p.id);
  }
  if (pool.length === 0) return [];
  const n = Math.min(Math.max(1, count), pool.length);
  const shuffled = shuffleIdsWithSeed(pool, seed);
  return shuffled.slice(0, n);
}

export function loadMissionProductIds(userId: string, dateKey: string): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(listKey(userId, dateKey));
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const ids = arr.filter((x): x is string => typeof x === 'string');
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export function saveMissionProductIds(userId: string, dateKey: string, ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(listKey(userId, dateKey), JSON.stringify(ids));
  } catch {
    /* quota */
  }
}

export function loadUsedIdsInDay(userId: string, dateKey: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(usedKey(userId, dateKey));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** IDs sorteados hoy por cualquier usuario en este navegador (misma partición) para reducir traslapes. */
export function loadUsedIdsInDayAllUsers(dateKey: string): Set<string> {
  const out = new Set<string>();
  if (typeof localStorage === 'undefined') return out;
  const suffix = `_${dateKey}`;
  const marker = `${STORAGE_PREFIX}_used_v2_`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(marker) || !k.endsWith(suffix)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) continue;
      arr.filter((x): x is string => typeof x === 'string').forEach((id) => out.add(id));
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function saveUsedIdsInDay(userId: string, dateKey: string, used: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(usedKey(userId, dateKey), JSON.stringify([...used]));
  } catch {
    /* ignore */
  }
}

/** IDs ya sorteados en listas anteriores del mismo día (para no repetir artículos entre misiones). */
export function addUsedIdsToDay(userId: string, dateKey: string, ids: string[]): void {
  const set = loadUsedIdsInDay(userId, dateKey);
  ids.forEach((id) => set.add(id));
  saveUsedIdsInDay(userId, dateKey, set);
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

export type MissionCloudStatePartition = {
  doneIds: string[];
  productIds: string[];
  usedIds: string[];
};

export type MissionCloudStateDoc = {
  activePartitionKey: string | null;
  partitions: Record<string, MissionCloudStatePartition>;
};

/** Exporta estado de misión del usuario (localStorage) para sincronizar en nube. */
export function exportMissionStateForUser(userId: string): MissionCloudStateDoc {
  const result: MissionCloudStateDoc = { activePartitionKey: loadActiveMissionPartitionKey(userId), partitions: {} };
  if (typeof localStorage === 'undefined') return result;
  const donePrefix = `${STORAGE_PREFIX}_${userId}_`;
  const listPrefix = `${STORAGE_PREFIX}_list_v2_${userId}_`;
  const usedPrefix = `${STORAGE_PREFIX}_used_v2_${userId}_`;
  const ensure = (pk: string): MissionCloudStatePartition => {
    if (!result.partitions[pk]) {
      result.partitions[pk] = { doneIds: [], productIds: [], usedIds: [] };
    }
    return result.partitions[pk]!;
  };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    try {
      if (k.startsWith(donePrefix)) {
        const pk = k.slice(donePrefix.length);
        ensure(pk).doneIds = [...loadMissionDoneIds(userId, pk)];
      } else if (k.startsWith(listPrefix)) {
        const pk = k.slice(listPrefix.length);
        ensure(pk).productIds = loadMissionProductIds(userId, pk) ?? [];
      } else if (k.startsWith(usedPrefix)) {
        const pk = k.slice(usedPrefix.length);
        ensure(pk).usedIds = [...loadUsedIdsInDay(userId, pk)];
      }
    } catch {
      /* ignore bad localStorage rows */
    }
  }
  return result;
}

/** Importa estado de misión desde nube al almacenamiento local del dispositivo. */
export function importMissionStateForUser(userId: string, doc: MissionCloudStateDoc | null | undefined): void {
  if (!doc) return;
  if (doc.activePartitionKey && doc.activePartitionKey.trim()) {
    saveActiveMissionPartitionKey(userId, doc.activePartitionKey.trim());
  }
  const parts = doc.partitions ?? {};
  for (const [pkRaw, payload] of Object.entries(parts)) {
    const pk = pkRaw.trim();
    if (!pk) continue;
    if (Array.isArray(payload?.doneIds)) saveMissionDoneIds(userId, pk, new Set(payload.doneIds));
    if (Array.isArray(payload?.productIds)) saveMissionProductIds(userId, pk, payload.productIds);
    if (Array.isArray(payload?.usedIds)) saveUsedIdsInDay(userId, pk, new Set(payload.usedIds));
  }
}

/**
 * Une los IDs marcados como revisados por **todos** los usuarios en este navegador (localStorage),
 * en el ciclo bimestral que contiene `dateKey`. Sirve para la vista solo-progreso del admin.
 */
export function mergeAllUsersMissionDoneInCycle(dateKey: string): Set<string> {
  const merged = new Set<string>();
  if (typeof localStorage === 'undefined') return merged;
  const { periodStartKey, periodEndKey } = getBimonthCycleInfo(dateKey);
  const partitions = new Set<string>();
  let d = periodStartKey;
  let guard = 0;
  while (d <= periodEndKey && guard < 400) {
    guard++;
    partitions.add(effectiveDateKeyForMissionPartition(d));
    if (d >= periodEndKey) break;
    d = addDaysToMexicoDateKey(d, 1);
  }
  const prefix = `${STORAGE_PREFIX}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix) || k.includes('_list_') || k.includes('_used_')) continue;
    const rest = k.slice(prefix.length);
    const lastU = rest.lastIndexOf('_');
    if (lastU <= 0) continue;
    const partitionFromKey = rest.slice(lastU + 1);
    if (!partitions.has(partitionFromKey)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) continue;
      arr.filter((x): x is string => typeof x === 'string').forEach((id) => merged.add(id));
    } catch {
      /* ignore */
    }
  }
  return merged;
}

/** IDs marcados como revisados en cualquier día del ciclo bimestral actual (misma clave de fecha). */
export function mergeMissionDoneIdsInCycle(userId: string, dateKey: string): Set<string> {
  const { periodStartKey, periodEndKey } = getBimonthCycleInfo(dateKey);
  const merged = new Set<string>();
  let d = periodStartKey;
  let guard = 0;
  while (d <= periodEndKey && guard < 400) {
    guard++;
    const sk = effectiveDateKeyForMissionPartition(d);
    loadMissionDoneIds(userId, sk).forEach((id) => merged.add(id));
    if (d >= periodEndKey) break;
    d = addDaysToMexicoDateKey(d, 1);
  }
  const activePk = loadActiveMissionPartitionKey(userId);
  if (activePk) {
    loadMissionDoneIds(userId, activePk).forEach((id) => merged.add(id));
  }
  return merged;
}
