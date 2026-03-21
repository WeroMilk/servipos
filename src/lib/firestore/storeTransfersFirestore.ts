import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { IncomingStoreTransfer, StoreTransferLine } from '@/types';
import {
  ensureProductAtDestForTransfer,
  resolveDestProductIdForTransfer,
} from '@/lib/firestore/productsFirestore';

function incomingTransfersCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'incomingTransfers');
}

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

function mapItems(raw: unknown): StoreTransferLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const o = x as Record<string, unknown>;
    return {
      productIdOrigen: String(o.productIdOrigen ?? ''),
      sku: String(o.sku ?? ''),
      nombre: String(o.nombre ?? ''),
      cantidad: Number(o.cantidad) || 0,
    };
  });
}

function docToIncoming(id: string, d: Record<string, unknown>): IncomingStoreTransfer {
  return {
    id,
    estado: d.estado === 'recibida' ? 'recibida' : 'pendiente',
    origenSucursalId: String(d.origenSucursalId ?? ''),
    origenSaleId: String(d.origenSaleId ?? ''),
    origenFolio: String(d.origenFolio ?? ''),
    items: mapItems(d.items),
    usuarioNombre:
      typeof d.usuarioNombre === 'string' && d.usuarioNombre.trim().length > 0
        ? d.usuarioNombre.trim()
        : undefined,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    recibidaAt: d.recibidaAt != null ? firestoreTimestampToDate(d.recibidaAt) : undefined,
    recibidaPorUserId: d.recibidaPorUserId != null ? String(d.recibidaPorUserId) : undefined,
    recibidaPorNombre:
      typeof d.recibidaPorNombre === 'string' && d.recibidaPorNombre.trim().length > 0
        ? d.recibidaPorNombre.trim()
        : undefined,
  };
}

export function subscribePendingIncomingTransfers(
  sucursalId: string,
  onData: (rows: IncomingStoreTransfer[]) => void
): Unsubscribe {
  const q = query(incomingTransfersCol(sucursalId), where('estado', '==', 'pendiente'));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((s) => docToIncoming(s.id, s.data() as Record<string, unknown>))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      onData(rows);
    },
    () => {
      onData([]);
    }
  );
}

export function subscribeOutgoingPendingTransferIds(
  sucursalId: string,
  onIds: (ids: Set<string>) => void
): Unsubscribe {
  const q = query(
    collection(db, 'sucursales', sucursalId, 'outgoingTransfers'),
    where('estado', '==', 'pendiente')
  );
  return onSnapshot(
    q,
    (snap) => {
      onIds(new Set(snap.docs.map((d) => d.id)));
    },
    () => {
      onIds(new Set());
    }
  );
}

/**
 * Aplica entrada de inventario en la tienda destino y marca el traspaso como recibido (origen + destino).
 */
export async function confirmIncomingStoreTransfer(
  destSucursalId: string,
  transferId: string,
  usuarioId: string,
  usuarioNombre: string
): Promise<void> {
  const incRef = doc(db, 'sucursales', destSucursalId, 'incomingTransfers', transferId);
  const incSnap = await getDoc(incRef);
  if (!incSnap.exists()) throw new Error('Traspaso no encontrado');
  const data = incSnap.data() as Record<string, unknown>;
  if (data.estado !== 'pendiente') throw new Error('Este traspaso ya fue confirmado');

  const items = mapItems(data.items);
  const origenSucursalId = String(data.origenSucursalId ?? '');
  if (!origenSucursalId) throw new Error('Datos de traspaso incompletos');

  const resolved: { destProductId: string; cantidad: number; nombre: string }[] = [];
  for (const line of items) {
    if (line.cantidad <= 0) continue;
    let pid = await resolveDestProductIdForTransfer(
      destSucursalId,
      line.productIdOrigen,
      line.sku
    );
    if (!pid) {
      pid = await ensureProductAtDestForTransfer(destSucursalId, origenSucursalId, line.productIdOrigen, {
        nombre: line.nombre,
        sku: line.sku,
      });
    }
    resolved.push({ destProductId: pid, cantidad: line.cantidad, nombre: line.nombre });
  }

  const outRef = doc(db, 'sucursales', origenSucursalId, 'outgoingTransfers', transferId);

  await runTransaction(db, async (transaction) => {
    const incFresh = await transaction.get(incRef);
    if (!incFresh.exists()) throw new Error('Traspaso no encontrado');
    const incD = incFresh.data() as Record<string, unknown>;
    if (incD.estado !== 'pendiente') throw new Error('Este traspaso ya fue confirmado');

    const outFresh = await transaction.get(outRef);
    if (!outFresh.exists()) throw new Error('Registro de salida en origen no encontrado');
    const outD = outFresh.data() as Record<string, unknown>;
    if (outD.estado !== 'pendiente') throw new Error('El envío ya fue marcado como recibido desde origen');

    for (const r of resolved) {
      const pref = doc(db, 'sucursales', destSucursalId, 'products', r.destProductId);
      const ps = await transaction.get(pref);
      if (!ps.exists()) throw new Error(`Producto no encontrado: ${r.nombre}`);
      const pdata = ps.data() as Record<string, unknown>;
      const cantidadAnterior =
        typeof pdata.existencia === 'number' ? pdata.existencia : Number(pdata.existencia) || 0;
      const cantidadNueva = cantidadAnterior + r.cantidad;

      transaction.update(pref, {
        existencia: cantidadNueva,
        updatedAt: serverTimestamp(),
      });

      const movRef = doc(movementsCol(destSucursalId));
      transaction.set(movRef, {
        productId: r.destProductId,
        tipo: 'entrada',
        cantidad: r.cantidad,
        cantidadAnterior,
        cantidadNueva,
        motivo: 'Traspaso recibido',
        referencia: transferId,
        usuarioId,
        createdAt: serverTimestamp(),
      });
    }

    const patch = {
      estado: 'recibida',
      recibidaAt: serverTimestamp(),
      recibidaPorUserId: usuarioId,
      recibidaPorNombre: usuarioNombre,
      updatedAt: serverTimestamp(),
    };

    transaction.update(incRef, patch);
    transaction.update(outRef, patch);
  });
}
