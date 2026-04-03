import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InventoryMovement } from '@/types';

const DEFAULT_LIMIT = 500;

function movementsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'inventoryMovements');
}

function firestoreTimestampToDate(value: unknown): Date {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

const TIPOS: InventoryMovement['tipo'][] = [
  'entrada',
  'salida',
  'ajuste',
  'venta',
  'compra',
  'producto_alta',
  'producto_baja',
  'producto_edicion',
];

function parseTipo(raw: unknown): InventoryMovement['tipo'] {
  const s = String(raw ?? '');
  return TIPOS.includes(s as InventoryMovement['tipo']) ? (s as InventoryMovement['tipo']) : 'ajuste';
}

export function movementDocToMovement(id: string, d: Record<string, unknown>): InventoryMovement {
  const pu = d.precioUnitarioCompra;
  const precioUnitarioCompra =
    typeof pu === 'number' && Number.isFinite(pu) && pu >= 0 ? pu : undefined;
  const prov = d.proveedor != null ? String(d.proveedor).trim() : '';
  const provCodRaw = d.proveedorCodigo != null ? String(d.proveedorCodigo).trim() : '';
  const nr = d.nombreRegistro != null ? String(d.nombreRegistro).trim() : '';
  const sr = d.skuRegistro != null ? String(d.skuRegistro).trim() : '';
  return {
    id,
    productId: String(d.productId ?? ''),
    tipo: parseTipo(d.tipo),
    cantidad: Number(d.cantidad) || 0,
    cantidadAnterior: Number(d.cantidadAnterior) || 0,
    cantidadNueva: Number(d.cantidadNueva) || 0,
    motivo: d.motivo != null && String(d.motivo).length > 0 ? String(d.motivo) : undefined,
    referencia: d.referencia != null && String(d.referencia).length > 0 ? String(d.referencia) : undefined,
    proveedor: prov.length > 0 ? prov : undefined,
    proveedorCodigo: provCodRaw.length > 0 ? provCodRaw : undefined,
    precioUnitarioCompra,
    nombreRegistro: nr.length > 0 ? nr : undefined,
    skuRegistro: sr.length > 0 ? sr : undefined,
    usuarioId: String(d.usuarioId ?? ''),
    createdAt: firestoreTimestampToDate(d.createdAt),
    syncStatus: 'synced',
  };
}

export type CatalogInventoryMovementInput = {
  productId: string;
  tipo: 'producto_alta' | 'producto_baja' | 'producto_edicion';
  motivo: string;
  usuarioId: string;
  nombreRegistro?: string;
  skuRegistro?: string;
};

/** Registro de alta, baja o edición de catálogo (misma colección que movimientos de stock). */
export async function appendCatalogInventoryMovementFirestore(
  sucursalId: string,
  input: CatalogInventoryMovementInput
): Promise<void> {
  await addDoc(movementsCol(sucursalId), {
    productId: input.productId,
    tipo: input.tipo,
    cantidad: 0,
    cantidadAnterior: 0,
    cantidadNueva: 0,
    motivo: input.motivo,
    referencia: null,
    proveedor: null,
    precioUnitarioCompra: null,
    nombreRegistro: input.nombreRegistro?.trim() || null,
    skuRegistro: input.skuRegistro?.trim() || null,
    usuarioId: input.usuarioId,
    createdAt: serverTimestamp(),
  });
}

/** Suscripción a los movimientos más recientes (orden descendente por fecha). */
const BY_PRODUCT_LIMIT = 200;

/** Movimientos de un solo producto (p. ej. historial de entradas en inventario). */
export async function fetchInventoryMovementsByProductIdFirestore(
  sucursalId: string,
  productId: string,
  maxDocs = BY_PRODUCT_LIMIT
): Promise<InventoryMovement[]> {
  const pid = productId.trim();
  if (!pid) return [];
  const q = query(movementsCol(sucursalId), where('productId', '==', pid), limit(maxDocs));
  const snap = await getDocs(q);
  const list = snap.docs.map((doc) =>
    movementDocToMovement(doc.id, doc.data() as Record<string, unknown>)
  );
  list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list;
}

/** Lectura única de los movimientos más recientes (misma ventana que la suscripción). */
export async function fetchRecentInventoryMovementsOnce(
  sucursalId: string,
  maxDocs = DEFAULT_LIMIT
): Promise<InventoryMovement[]> {
  const q = query(movementsCol(sucursalId), orderBy('createdAt', 'desc'), limit(maxDocs));
  const snap = await getDocs(q);
  return snap.docs.map((doc) =>
    movementDocToMovement(doc.id, doc.data() as Record<string, unknown>)
  );
}

export function subscribeInventoryMovements(
  sucursalId: string,
  onUpdate: (movements: InventoryMovement[]) => void,
  maxDocs = DEFAULT_LIMIT
): Unsubscribe {
  const q = query(movementsCol(sucursalId), orderBy('createdAt', 'desc'), limit(maxDocs));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((doc) => movementDocToMovement(doc.id, doc.data() as Record<string, unknown>));
      onUpdate(rows);
    },
    (err) => {
      console.error('inventoryMovements:', err);
      onUpdate([]);
    }
  );
}

/** Elimina todos los documentos de movimientos (por lotes de 500). Solo usar con permisos de admin en reglas. */
export async function deleteAllInventoryMovementsFirestore(sucursalId: string): Promise<void> {
  const col = movementsCol(sucursalId);
  for (;;) {
    const snap = await getDocs(query(col, limit(500)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
