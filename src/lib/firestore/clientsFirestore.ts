import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Client } from '@/types';
import { normalizeClientPriceListId } from '@/lib/clientPriceLists';

function clientsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'clients');
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

export function docToClient(sucursalId: string, id: string, d: Record<string, unknown>): Client {
  return {
    id,
    rfc: d.rfc != null ? String(d.rfc) : undefined,
    nombre: String(d.nombre ?? ''),
    razonSocial: d.razonSocial != null ? String(d.razonSocial) : undefined,
    codigoPostal: d.codigoPostal != null ? String(d.codigoPostal) : undefined,
    regimenFiscal: d.regimenFiscal != null ? String(d.regimenFiscal) : undefined,
    usoCfdi: d.usoCfdi != null ? String(d.usoCfdi) : undefined,
    email: d.email != null ? String(d.email) : undefined,
    telefono: d.telefono != null ? String(d.telefono) : undefined,
    direccion:
      d.direccion && typeof d.direccion === 'object'
        ? (d.direccion as Client['direccion'])
        : undefined,
    isMostrador: d.isMostrador === true,
    listaPreciosId:
      d.listaPreciosId != null && d.listaPreciosId !== ''
        ? normalizeClientPriceListId(d.listaPreciosId)
        : undefined,
    ticketsComprados:
      d.ticketsComprados != null && Number.isFinite(Number(d.ticketsComprados))
        ? Number(d.ticketsComprados)
        : undefined,
    sucursalId,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

function clientToFirestorePayload(
  client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Record<string, unknown> {
  return {
    rfc: client.rfc ?? null,
    nombre: client.nombre,
    razonSocial: client.razonSocial ?? null,
    codigoPostal: client.codigoPostal ?? null,
    regimenFiscal: client.regimenFiscal ?? null,
    usoCfdi: client.usoCfdi ?? null,
    email: client.email ?? null,
    telefono: client.telefono ?? null,
    direccion: client.direccion ?? null,
    isMostrador: client.isMostrador === true,
    listaPreciosId: client.listaPreciosId ?? null,
    ticketsComprados: client.ticketsComprados ?? null,
    sucursalId: client.sucursalId ?? null,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Clientes en tiempo real por sucursal; opcional `onMirrorLocal` solo en snapshots OK (no en error).
 */
export function subscribeClientsCatalog(
  sucursalId: string,
  onData: (clients: Client[]) => void,
  onMirrorLocal?: (clients: Client[]) => void | Promise<void>
): Unsubscribe {
  const q = query(clientsCol(sucursalId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((s) =>
        docToClient(sucursalId, s.id, s.data() as Record<string, unknown>)
      );
      list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      void onMirrorLocal?.(list);
      onData(list);
    },
    (err) => {
      console.error('subscribeClientsCatalog:', err);
      onData([]);
    }
  );
}

export async function createClientFirestore(
  sucursalId: string,
  client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>,
  id: string
): Promise<string> {
  const ref = doc(db, 'sucursales', sucursalId, 'clients', id);
  await setDoc(ref, {
    ...clientToFirestorePayload(client),
    createdAt: serverTimestamp(),
  });
  return id;
}

export async function updateClientFirestore(
  sucursalId: string,
  id: string,
  updates: Partial<Client>
): Promise<void> {
  const ref = doc(db, 'sucursales', sucursalId, 'clients', id);
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.nombre !== undefined) patch.nombre = updates.nombre;
  if (updates.rfc !== undefined) patch.rfc = updates.rfc ?? null;
  if (updates.razonSocial !== undefined) patch.razonSocial = updates.razonSocial ?? null;
  if (updates.codigoPostal !== undefined) patch.codigoPostal = updates.codigoPostal ?? null;
  if (updates.regimenFiscal !== undefined) patch.regimenFiscal = updates.regimenFiscal ?? null;
  if (updates.usoCfdi !== undefined) patch.usoCfdi = updates.usoCfdi ?? null;
  if (updates.email !== undefined) patch.email = updates.email ?? null;
  if (updates.telefono !== undefined) patch.telefono = updates.telefono ?? null;
  if (updates.direccion !== undefined) patch.direccion = updates.direccion ?? null;
  if (updates.isMostrador !== undefined) patch.isMostrador = updates.isMostrador;
  if (updates.listaPreciosId !== undefined) patch.listaPreciosId = updates.listaPreciosId ?? null;
  if (updates.ticketsComprados !== undefined) patch.ticketsComprados = updates.ticketsComprados ?? null;
  await updateDoc(ref, patch);
}

export async function deleteClientFirestore(sucursalId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'sucursales', sucursalId, 'clients', id));
}
