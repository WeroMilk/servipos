import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
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

const TIPOS: InventoryMovement['tipo'][] = ['entrada', 'salida', 'ajuste', 'venta', 'compra'];

function parseTipo(raw: unknown): InventoryMovement['tipo'] {
  const s = String(raw ?? '');
  return TIPOS.includes(s as InventoryMovement['tipo']) ? (s as InventoryMovement['tipo']) : 'ajuste';
}

export function movementDocToMovement(id: string, d: Record<string, unknown>): InventoryMovement {
  return {
    id,
    productId: String(d.productId ?? ''),
    tipo: parseTipo(d.tipo),
    cantidad: Number(d.cantidad) || 0,
    cantidadAnterior: Number(d.cantidadAnterior) || 0,
    cantidadNueva: Number(d.cantidadNueva) || 0,
    motivo: d.motivo != null && String(d.motivo).length > 0 ? String(d.motivo) : undefined,
    referencia: d.referencia != null && String(d.referencia).length > 0 ? String(d.referencia) : undefined,
    usuarioId: String(d.usuarioId ?? ''),
    createdAt: firestoreTimestampToDate(d.createdAt),
    syncStatus: 'synced',
  };
}

/** Suscripción a los movimientos más recientes (orden descendente por fecha). */
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
