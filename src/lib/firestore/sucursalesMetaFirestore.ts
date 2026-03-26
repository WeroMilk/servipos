import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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

/** Vuelve a marcar la sucursal como activa en el catálogo. */
export async function reactivateSucursal(id: string): Promise<void> {
  await updateSucursalMeta(id, { activo: true });
}

const CHECADOR_COL = 'checadorRegistros';
const USERS_COL = 'users';
const BRANCH_SUBCOLLECTIONS = [
  'sales',
  'inventoryMovements',
  'products',
  'counters',
  'clients',
  'config',
] as const;

async function wipeChecadorBySucursalId(sucursalId: string): Promise<void> {
  const checadorCol = collection(db, CHECADOR_COL);
  for (;;) {
    const snap = await getDocs(
      query(checadorCol, where('sucursalId', '==', sucursalId), limit(500))
    );
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 500) break;
  }
}

/** Vacía una subcolección directa bajo `sucursales/{id}/…`. */
async function wipeSucursalSubcollection(sucursalId: string, name: string): Promise<void> {
  const colRef = collection(db, COL, sucursalId, name);
  for (;;) {
    const snap = await getDocs(query(colRef, limit(500)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 500) break;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Elimina la sucursal en Firestore: metadato, productos, ventas, movimientos, contadores,
 * fichajes del checador ligados a esa tienda (y legado sin `sucursalId` para usuarios de la tienda),
 * y quita `sucursalId` en perfiles de usuario.
 * Irreversible. Requiere admin en reglas.
 */
export async function hardDeleteSucursal(sucursalId: string): Promise<void> {
  const id = sucursalId.trim();
  if (!id) throw new Error('Id de sucursal inválido');

  const metaRef = doc(db, COL, id);
  const metaSnap = await getDoc(metaRef);
  if (metaSnap.exists()) {
    const d = metaSnap.data() as Record<string, unknown>;
    if (d.activo !== false && d.activa !== false) {
      throw new Error('Desactive la sucursal antes de eliminarla por completo');
    }
  }

  const usersSnap = await getDocs(query(collection(db, USERS_COL), where('sucursalId', '==', id)));
  const userIdsForBranch = usersSnap.docs.map((d) => d.id);

  for (const sub of BRANCH_SUBCOLLECTIONS) {
    await wipeSucursalSubcollection(id, sub);
  }

  const checadorCol = collection(db, CHECADOR_COL);
  await wipeChecadorBySucursalId(id);

  for (const uidChunk of chunk(userIdsForBranch, 30)) {
    if (uidChunk.length === 0) continue;
    const legSnap = await getDocs(query(checadorCol, where('userId', 'in', uidChunk)));
    const toDelete = legSnap.docs.filter((d) => {
      const data = d.data() as Record<string, unknown>;
      const sid = data.sucursalId;
      return sid == null || sid === '';
    });
    for (let i = 0; i < toDelete.length; i += 500) {
      const slice = toDelete.slice(i, i + 500);
      const batch = writeBatch(db);
      slice.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  for (let i = 0; i < usersSnap.docs.length; i += 400) {
    const batch = writeBatch(db);
    usersSnap.docs.slice(i, i + 400).forEach((u) => {
      batch.update(doc(db, USERS_COL, u.id), { sucursalId: null, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }

  await deleteDoc(metaRef);
}
