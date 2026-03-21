import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_SUCURSAL_IDS } from '@/lib/sucursales';
import type { Sucursal } from '@/types';

const COL = 'sucursales';

function tsToDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date();
}

/** Título legible si falta `nombre` o viene corrupto (p. ej. boolean en Firestore). */
function nombreDisplayFromId(id: string): string {
  const t = id.replace(/_/g, ' ').trim();
  if (!t) return id;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Valores que a veces se guardan por error en `nombre`/`codigo` al confundirlos con flags booleanos. */
function isGarbageDisplayToken(s: string): boolean {
  const n = s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    n === 'true' ||
    n === 'false' ||
    n === 'verdadero' ||
    n === 'falso' ||
    n === 'yes' ||
    n === 'no' ||
    n === 'si' ||
    n === 'sí'
  );
}

function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function optionalCodigo(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0 || isGarbageDisplayToken(t)) return undefined;
  return t;
}

export function docToSucursal(id: string, d: Record<string, unknown>): Sucursal {
  const rawNombre = firstNonEmptyString(
    d.nombre,
    d.name,
    d.nombreSucursal,
    d.titulo,
    d.displayName,
    d.label
  );
  const nombre =
    rawNombre && !isGarbageDisplayToken(rawNombre)
      ? rawNombre
      : nombreDisplayFromId(id);
  return {
    id,
    nombre,
    codigo: optionalCodigo(d.codigo),
    activo: d.activo !== false && d.activa !== false,
    createdAt: tsToDate(d.createdAt),
    updatedAt: tsToDate(d.updatedAt),
  };
}

function mergeWithDefaultIds(fromFs: Sucursal[]): Sucursal[] {
  const byId = new Map(fromFs.map((s) => [s.id, s] as const));
  const ids = [...new Set([...DEFAULT_SUCURSAL_IDS, ...fromFs.map((s) => s.id)])];
  const epoch = new Date(0);
  const merged = ids.map(
    (id) =>
      byId.get(id) ?? {
        id,
        nombre: id,
        activo: true,
        createdAt: epoch,
        updatedAt: epoch,
      }
  );
  merged.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return merged;
}

export function subscribeSucursales(onList: (list: Sucursal[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, COL),
    (snap) => {
      const fromFs: Sucursal[] = snap.docs.map((s) =>
        docToSucursal(s.id, s.data() as Record<string, unknown>)
      );
      onList(mergeWithDefaultIds(fromFs));
    },
    (err) => {
      console.error('Sucursales:', err);
      onList(mergeWithDefaultIds([]));
    }
  );
}

/** Solo documentos reales en Firestore (sin placeholders de `DEFAULT_SUCURSAL_IDS`). Para selectores y listas de tiendas. */
export function subscribeSucursalesCatalog(onList: (list: Sucursal[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, COL),
    (snap) => {
      const list = snap.docs.map((s) => docToSucursal(s.id, s.data() as Record<string, unknown>));
      list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
      onList(list);
    },
    (err) => {
      console.error('Sucursales:', err);
      onList([]);
    }
  );
}

function slugSucursalDocId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return (s.length > 0 ? s : 'sucursal').slice(0, 64);
}

/** Crea el documento `sucursales/{id}` con id estable (misma ruta que productos/ventas). */
export async function createSucursalMeta(input: {
  /** Si se omite, se genera a partir de `nombre`. */
  id?: string;
  nombre: string;
  codigo?: string;
}): Promise<string> {
  const id = slugSucursalDocId(input.id || input.nombre);
  const ref = doc(db, COL, id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error(`Ya existe una sucursal con el id "${id}"`);
  }
  await setDoc(ref, {
    nombre: input.nombre.trim(),
    codigo: input.codigo?.trim() || null,
    activo: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export async function updateSucursalMeta(
  id: string,
  patch: { nombre?: string; codigo?: string | null; activo?: boolean }
): Promise<void> {
  const ref = doc(db, COL, id);
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.nombre !== undefined) payload.nombre = patch.nombre.trim();
  if (patch.codigo !== undefined) payload.codigo = patch.codigo === null || patch.codigo === '' ? null : patch.codigo.trim();
  if (patch.activo !== undefined) payload.activo = patch.activo;
  await updateDoc(ref, payload);
}

/** Baja lógica: no borra subcolecciones (productos, ventas, etc.). */
export async function softDeleteSucursal(id: string): Promise<void> {
  await updateSucursalMeta(id, { activo: false });
}
