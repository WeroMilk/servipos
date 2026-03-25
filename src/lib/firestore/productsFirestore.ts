import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Product, StockEntradaMeta } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';
import { normalizeClaveProdServ, normalizeClaveUnidadSat } from '@/lib/satCatalog';

// ============================================
// PRODUCTOS + STOCK EN FIRESTORE (por sucursal)
// ============================================

function productsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'products');
}

function movementsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'inventoryMovements');
}

function parsePreciosPorListaCliente(raw: unknown): Product['preciosPorListaCliente'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<ClientPriceListId, number>> = {};
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const v = o[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[id] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

export function docToProduct(snap: QueryDocumentSnapshot): Product {
  const d = snap.data();
  return {
    id: snap.id,
    sku: String(d.sku ?? ''),
    codigoBarras: d.codigoBarras != null ? String(d.codigoBarras) : undefined,
    nombre: String(d.nombre ?? ''),
    descripcion: d.descripcion != null ? String(d.descripcion) : undefined,
    precioVenta: typeof d.precioVenta === 'number' ? d.precioVenta : Number(d.precioVenta) || 0,
    precioCompra: d.precioCompra != null ? Number(d.precioCompra) : undefined,
    impuesto: typeof d.impuesto === 'number' ? d.impuesto : Number(d.impuesto) || 16,
    existencia: typeof d.existencia === 'number' ? d.existencia : Number(d.existencia) || 0,
    existenciaMinima:
      typeof d.existenciaMinima === 'number' ? d.existenciaMinima : Number(d.existenciaMinima) || 0,
    categoria: d.categoria != null ? String(d.categoria) : undefined,
    proveedor: d.proveedor != null ? String(d.proveedor) : undefined,
    preciosPorListaCliente: parsePreciosPorListaCliente(d.preciosPorListaCliente),
    imagen: d.imagen != null ? String(d.imagen) : undefined,
    unidadMedida: normalizeClaveUnidadSat(d.unidadMedida != null ? String(d.unidadMedida) : 'H87'),
    claveProdServ: (() => {
      const raw = d.claveProdServ != null ? String(d.claveProdServ).replace(/\D/g, '').slice(0, 8) : '';
      return raw.length === 8 ? raw : undefined;
    })(),
    activo: d.activo !== false,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

function productToFirestorePayload(
  product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Record<string, unknown> {
  return {
    sku: product.sku,
    codigoBarras: product.codigoBarras ?? null,
    nombre: product.nombre,
    descripcion: product.descripcion ?? null,
    precioVenta: product.precioVenta,
    precioCompra: product.precioCompra ?? null,
    impuesto: product.impuesto,
    existencia: product.existencia,
    existenciaMinima: product.existenciaMinima,
    categoria: product.categoria ?? null,
    proveedor: product.proveedor ?? null,
    preciosPorListaCliente:
      product.preciosPorListaCliente && Object.keys(product.preciosPorListaCliente).length > 0
        ? product.preciosPorListaCliente
        : null,
    imagen: product.imagen ?? null,
    unidadMedida: normalizeClaveUnidadSat(product.unidadMedida),
    claveProdServ:
      normalizeClaveProdServ(product.claveProdServ).length === 8
        ? normalizeClaveProdServ(product.claveProdServ)
        : null,
    activo: product.activo,
  };
}

// --- Catálogo en tiempo real (un listener por sucursal activa en la app) ---

let lastProducts: Product[] = [];
const catalogListeners = new Set<(products: Product[]) => void>();
let catalogUnsub: Unsubscribe | null = null;
let catalogSucursalId: string | null = null;

export function getProductCatalogSnapshot(): Product[] {
  return lastProducts;
}

export function subscribeProductCatalog(
  sucursalId: string,
  onProducts: (products: Product[]) => void
): () => void {
  try {
    onProducts([...lastProducts]);
  } catch (e) {
    console.error('subscribeProductCatalog (initial):', e);
  }
  catalogListeners.add(onProducts);

  if (catalogSucursalId !== sucursalId) {
    catalogUnsub?.();
    catalogSucursalId = sucursalId;
    const q = query(productsCol(sucursalId), where('activo', '==', true));
    catalogUnsub = onSnapshot(
      q,
      (snap) => {
        lastProducts = snap.docs.map(docToProduct);
        lastProducts.sort((a, b) =>
          String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es')
        );
        catalogListeners.forEach((l) => {
          try {
            l([...lastProducts]);
          } catch (e) {
            console.error('subscribeProductCatalog listener:', e);
          }
        });
      },
      (err) => {
        console.error('Firestore products:', err);
        lastProducts = [];
        catalogListeners.forEach((l) => l([]));
      }
    );
  }

  return () => {
    catalogListeners.delete(onProducts);
    if (catalogListeners.size === 0) {
      catalogUnsub?.();
      catalogUnsub = null;
      catalogSucursalId = null;
      lastProducts = [];
    }
  };
}

export async function createProductFirestore(
  sucursalId: string,
  product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Promise<string> {
  const ref = doc(productsCol(sucursalId));
  const ts = serverTimestamp();
  await setDoc(ref, {
    ...productToFirestorePayload(product),
    createdAt: ts,
    updatedAt: ts,
  });
  return ref.id;
}

const PRODUCT_UPDATE_KEYS = [
  'sku',
  'nombre',
  'descripcion',
  'precioVenta',
  'precioCompra',
  'impuesto',
  'existencia',
  'existenciaMinima',
  'categoria',
  'proveedor',
  'imagen',
  'unidadMedida',
  'activo',
] as const satisfies readonly (keyof Product)[];

export async function updateProductFirestore(
  sucursalId: string,
  productId: string,
  updates: Partial<Product>
): Promise<void> {
  const ref = doc(db, 'sucursales', sucursalId, 'products', productId);
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

  for (const k of PRODUCT_UPDATE_KEYS) {
    if (k in updates && updates[k] !== undefined) {
      payload[k] = updates[k];
    }
  }

  if ('codigoBarras' in updates) {
    const v = updates.codigoBarras;
    payload.codigoBarras = v && v.length > 0 ? v : null;
  }

  if ('claveProdServ' in updates) {
    const n = normalizeClaveProdServ(updates.claveProdServ);
    payload.claveProdServ = n.length === 8 ? n : null;
  }

  if ('preciosPorListaCliente' in updates && updates.preciosPorListaCliente !== undefined) {
    const m = updates.preciosPorListaCliente;
    payload.preciosPorListaCliente =
      m && Object.keys(m).length > 0 ? m : null;
  }

  await updateDoc(ref, payload);
}

export async function deleteProductFirestore(sucursalId: string, productId: string): Promise<void> {
  await updateProductFirestore(sucursalId, productId, { activo: false });
}

export async function adjustStockFirestore(
  sucursalId: string,
  productId: string,
  cantidad: number,
  tipo: 'entrada' | 'salida' | 'ajuste',
  motivo?: string,
  referencia?: string,
  usuarioId?: string,
  entradaMeta?: StockEntradaMeta
): Promise<void> {
  const prodRef = doc(db, 'sucursales', sucursalId, 'products', productId);

  await runTransaction(db, async (transaction) => {
    const prodSnap = await transaction.get(prodRef);
    if (!prodSnap.exists()) throw new Error('Producto no encontrado');

    const data = prodSnap.data()!;
    const cantidadAnterior =
      typeof data.existencia === 'number' ? data.existencia : Number(data.existencia) || 0;
    let cantidadNueva: number;

    if (tipo === 'entrada') {
      cantidadNueva = cantidadAnterior + cantidad;
    } else if (tipo === 'salida') {
      cantidadNueva = cantidadAnterior - cantidad;
      if (cantidadNueva < 0) throw new Error('Stock insuficiente');
    } else {
      cantidadNueva = cantidad;
    }

    transaction.update(prodRef, {
      existencia: cantidadNueva,
      updatedAt: serverTimestamp(),
    });

    const movRef = doc(movementsCol(sucursalId));
    const prov = entradaMeta?.proveedor?.trim();
    const pu = entradaMeta?.precioUnitarioCompra;
    transaction.set(movRef, {
      productId,
      tipo,
      cantidad,
      cantidadAnterior,
      cantidadNueva,
      motivo: motivo ?? null,
      referencia: referencia ?? null,
      proveedor:
        tipo === 'entrada' && prov && prov.length > 0 ? prov : null,
      precioUnitarioCompra:
        tipo === 'entrada' && pu != null && Number.isFinite(pu) && pu >= 0 ? pu : null,
      usuarioId: usuarioId ?? 'system',
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Para recibir traspaso: mismo id de documento en destino, o un único producto activo con el mismo SKU.
 */
/**
 * Crea en destino un producto con el mismo id que en origen (o mínimo desde la línea del traspaso si no hay copia posible).
 * Existencia inicial 0; la confirmación del traspaso suma la cantidad recibida.
 */
export async function ensureProductAtDestForTransfer(
  destSucursalId: string,
  origenSucursalId: string,
  productIdOrigen: string,
  fallback: { nombre: string; sku: string }
): Promise<string> {
  const destRef = doc(db, 'sucursales', destSucursalId, 'products', productIdOrigen);
  const destEx = await getDoc(destRef);
  if (destEx.exists()) {
    const act = destEx.data()?.activo;
    if (act !== false) return productIdOrigen;
  }

  const origRef = doc(db, 'sucursales', origenSucursalId, 'products', productIdOrigen);
  let originOd: Record<string, unknown> | null = null;
  try {
    const origSnap = await getDoc(origRef);
    if (origSnap.exists()) originOd = origSnap.data() as Record<string, unknown>;
  } catch {
    originOd = null;
  }

  const ts = serverTimestamp();
  if (originOd) {
    const od = originOd;
    await setDoc(destRef, {
      sku: String(od.sku ?? fallback.sku ?? '').trim() || `T-${productIdOrigen.slice(0, 8)}`,
      codigoBarras: od.codigoBarras != null ? String(od.codigoBarras) : null,
      nombre: String(od.nombre ?? fallback.nombre).trim() || fallback.nombre,
      descripcion: od.descripcion != null ? String(od.descripcion) : null,
      precioVenta: typeof od.precioVenta === 'number' ? od.precioVenta : Number(od.precioVenta) || 0,
      precioCompra: od.precioCompra != null ? Number(od.precioCompra) : null,
      impuesto: typeof od.impuesto === 'number' ? od.impuesto : Number(od.impuesto) || 16,
      existencia: 0,
      existenciaMinima:
        typeof od.existenciaMinima === 'number' ? od.existenciaMinima : Number(od.existenciaMinima) || 0,
      categoria: od.categoria != null ? String(od.categoria) : null,
      proveedor: od.proveedor != null ? String(od.proveedor) : null,
      imagen: od.imagen != null ? String(od.imagen) : null,
      unidadMedida: String(od.unidadMedida ?? 'H87'),
      preciosPorListaCliente:
        od.preciosPorListaCliente != null && typeof od.preciosPorListaCliente === 'object'
          ? od.preciosPorListaCliente
          : null,
      activo: true,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    const sku =
      (fallback.sku ?? '').trim() || `T-${productIdOrigen.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'SKU'}`;
    await setDoc(destRef, {
      sku,
      codigoBarras: null,
      nombre: (fallback.nombre ?? '').trim() || 'Producto (traspaso)',
      descripcion: null,
      precioVenta: 0,
      precioCompra: null,
      impuesto: 16,
      existencia: 0,
      existenciaMinima: 0,
      categoria: null,
      proveedor: null,
      imagen: null,
      unidadMedida: 'H87',
      activo: true,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  return productIdOrigen;
}

export async function resolveDestProductIdForTransfer(
  destSucursalId: string,
  productIdOrigen: string,
  sku: string
): Promise<string | null> {
  const byIdRef = doc(db, 'sucursales', destSucursalId, 'products', productIdOrigen);
  const byId = await getDoc(byIdRef);
  if (byId.exists()) {
    const act = byId.data()?.activo;
    if (act !== false) return byId.id;
  }
  const sk = (sku ?? '').trim();
  if (!sk) return null;
  const q = query(productsCol(destSucursalId), where('sku', '==', sk), where('activo', '==', true), limit(2));
  const snap = await getDocs(q);
  if (snap.docs.length === 1) return snap.docs[0]!.id;
  return null;
}

export async function getProductByBarcodeFirestore(
  sucursalId: string,
  codigoBarras: string
): Promise<Product | null> {
  const q = query(productsCol(sucursalId), where('codigoBarras', '==', codigoBarras), limit(1));
  const snap = await getDocs(q);
  const first = snap.docs[0];
  if (!first) return null;
  return docToProduct(first as QueryDocumentSnapshot);
}
