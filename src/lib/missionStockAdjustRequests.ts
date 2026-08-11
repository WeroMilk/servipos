import {
  getSucursalStateDocOnce,
  saveSucursalStateDoc,
} from '@/lib/firestore/stateDocsFirestore';
import { isGabrielUser, isZavalaUser } from '@/lib/gabrielEasterEgg';
import { userIsGerenteOrAdmin } from '@/lib/userPermissions';
import {
  normalizeUbicacionKey,
  parseExistenciaPorUbicacion,
} from '@/lib/existenciaPorUbicacion';
import type { User } from '@/types';

export const MISSION_STOCK_ADJUST_REQUESTS_DOC_KEY = 'mission_stock_adjust_requests';

export type MissionStockAdjustOrigen = 'mision_lista' | 'conteo_mueble';

export type MissionStockAdjustRequest = {
  id: string;
  productId: string;
  productNombre: string;
  productSku: string;
  cantidadAnterior: number;
  cantidadNueva: number;
  comentario: string;
  origen: MissionStockAdjustOrigen;
  mueble?: string;
  /** Cantidad contada en el mueble (solo conteo por ubicación). */
  cantidadEnUbicacion?: number;
  /** Desglose resultante tras el conteo; al aprobar se persiste en el producto. */
  existenciaPorUbicacion?: Record<string, number>;
  solicitadoPorId: string;
  solicitadoPorNombre: string;
  createdAt: string;
};

export type MissionStockAdjustRequestsDoc = {
  items: MissionStockAdjustRequest[];
  updatedAt: string;
};

/** Encargados que pueden aplicar o aprobar ajustes desde misiones (Gabriel, Zavala, admin/gerente). */
export function userCanApproveMissionStockAdjust(
  user: Pick<User, 'username' | 'name' | 'email' | 'role' | 'isActive'> | null | undefined
): boolean {
  if (!user?.isActive) return false;
  if (userIsGerenteOrAdmin(user)) return true;
  return isGabrielUser(user) || isZavalaUser(user);
}

/** Cajeros (p. ej. Alfonso): el ajuste queda pendiente hasta aprobación. */
export function userNeedsMissionStockAdjustApproval(
  user: Pick<User, 'username' | 'name' | 'email' | 'role' | 'isActive'> | null | undefined
): boolean {
  return !userCanApproveMissionStockAdjust(user);
}

function normalizeRequest(raw: unknown): MissionStockAdjustRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const productId = typeof o.productId === 'string' ? o.productId.trim() : '';
  if (!id || !productId) return null;
  const cantidadAnterior = Math.trunc(Number(o.cantidadAnterior));
  const cantidadNueva = Math.trunc(Number(o.cantidadNueva));
  if (!Number.isFinite(cantidadAnterior) || !Number.isFinite(cantidadNueva)) return null;
  const origen: MissionStockAdjustOrigen =
    o.origen === 'conteo_mueble' ? 'conteo_mueble' : 'mision_lista';
  const solicitadoPorId = typeof o.solicitadoPorId === 'string' ? o.solicitadoPorId.trim() : '';
  if (!solicitadoPorId) return null;
  const item: MissionStockAdjustRequest = {
    id,
    productId,
    productNombre: typeof o.productNombre === 'string' ? o.productNombre : '',
    productSku: typeof o.productSku === 'string' ? o.productSku : '',
    cantidadAnterior,
    cantidadNueva,
    comentario: typeof o.comentario === 'string' ? o.comentario.trim() : '',
    origen,
    solicitadoPorId,
    solicitadoPorNombre:
      typeof o.solicitadoPorNombre === 'string' ? o.solicitadoPorNombre.trim() : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
  };
  if (typeof o.mueble === 'string' && o.mueble.trim()) {
    item.mueble = normalizeUbicacionKey(o.mueble);
  }
  const qtyUbic = Math.trunc(Number(o.cantidadEnUbicacion));
  if (Number.isFinite(qtyUbic) && qtyUbic >= 0) {
    item.cantidadEnUbicacion = qtyUbic;
  }
  const map = parseExistenciaPorUbicacion(o.existenciaPorUbicacion);
  if (map) item.existenciaPorUbicacion = map;
  return item;
}

export function parseMissionStockAdjustRequestsDoc(
  doc: unknown
): MissionStockAdjustRequestsDoc {
  if (!doc || typeof doc !== 'object') {
    return { items: [], updatedAt: new Date().toISOString() };
  }
  const o = doc as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw
    .map(normalizeRequest)
    .filter((x): x is MissionStockAdjustRequest => x != null);
  return {
    items,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
  };
}

export async function loadMissionStockAdjustRequests(
  sucursalId: string
): Promise<MissionStockAdjustRequestsDoc> {
  const doc = await getSucursalStateDocOnce<unknown>(
    sucursalId,
    MISSION_STOCK_ADJUST_REQUESTS_DOC_KEY
  );
  return parseMissionStockAdjustRequestsDoc(doc);
}

async function saveMissionStockAdjustRequests(
  sucursalId: string,
  items: MissionStockAdjustRequest[]
): Promise<void> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal activa');
  const doc: MissionStockAdjustRequestsDoc = {
    items,
    updatedAt: new Date().toISOString(),
  };
  await saveSucursalStateDoc(sid, MISSION_STOCK_ADJUST_REQUESTS_DOC_KEY, doc);
}

export type CreateMissionStockAdjustInput = {
  sucursalId: string;
  productId: string;
  productNombre: string;
  productSku: string;
  cantidadAnterior: number;
  cantidadNueva: number;
  comentario?: string;
  origen: MissionStockAdjustOrigen;
  mueble?: string;
  cantidadEnUbicacion?: number;
  existenciaPorUbicacion?: Record<string, number>;
  solicitadoPorId: string;
  solicitadoPorNombre: string;
};

/** Encola un ajuste pendiente. Si ya hay uno del mismo producto por el mismo cajero, lo reemplaza. */
export async function createMissionStockAdjustRequest(
  input: CreateMissionStockAdjustInput
): Promise<MissionStockAdjustRequest> {
  const sid = input.sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal activa');
  const productId = input.productId.trim();
  if (!productId) throw new Error('Producto inválido');
  const cantidadAnterior = Math.trunc(Number(input.cantidadAnterior));
  const cantidadNueva = Math.trunc(Number(input.cantidadNueva));
  if (!Number.isFinite(cantidadAnterior) || !Number.isFinite(cantidadNueva) || cantidadNueva < 0) {
    throw new Error('Cantidades inválidas');
  }
  const map = parseExistenciaPorUbicacion(input.existenciaPorUbicacion);
  if (cantidadAnterior === cantidadNueva && !map) {
    throw new Error('La cantidad no cambió');
  }

  const current = await loadMissionStockAdjustRequests(sid);
  const now = new Date().toISOString();
  const request: MissionStockAdjustRequest = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `msa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    productId,
    productNombre: input.productNombre.trim(),
    productSku: input.productSku.trim(),
    cantidadAnterior,
    cantidadNueva,
    comentario: (input.comentario ?? '').trim(),
    origen: input.origen,
    solicitadoPorId: input.solicitadoPorId.trim(),
    solicitadoPorNombre: input.solicitadoPorNombre.trim() || 'Cajero',
    createdAt: now,
  };
  if (input.mueble?.trim()) request.mueble = normalizeUbicacionKey(input.mueble);
  const qtyUbic = Math.trunc(Number(input.cantidadEnUbicacion));
  if (Number.isFinite(qtyUbic) && qtyUbic >= 0) {
    request.cantidadEnUbicacion = qtyUbic;
  }
  if (map) request.existenciaPorUbicacion = map;

  const items = current.items.filter(
    (x) => !(x.productId === productId && x.solicitadoPorId === request.solicitadoPorId)
  );
  items.unshift(request);
  await saveMissionStockAdjustRequests(sid, items.slice(0, 200));
  return request;
}

/** Quita una solicitud de la cola (tras aprobar o rechazar). */
export async function removeMissionStockAdjustRequest(
  sucursalId: string,
  requestId: string
): Promise<MissionStockAdjustRequest | null> {
  const sid = sucursalId.trim();
  const rid = requestId.trim();
  if (!sid || !rid) return null;
  const current = await loadMissionStockAdjustRequests(sid);
  const found = current.items.find((x) => x.id === rid) ?? null;
  if (!found) return null;
  await saveMissionStockAdjustRequests(
    sid,
    current.items.filter((x) => x.id !== rid)
  );
  return found;
}
