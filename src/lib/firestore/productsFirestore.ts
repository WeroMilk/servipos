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
import type { Product } from '@/types';

// ============================================
// PRODUCTOS + STOCK EN FIRESTORE (por sucursal)
// ============================================

function productsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'products');
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
    imagen: d.imagen != null ? String(d.imagen) : undefined,
    unidadMedida: String(d.unidadMedida ?? 'H87'),
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
    imagen: product.imagen ?? null,
    unidadMedida: product.unidadMedida,
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
  usuarioId?: string
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
    transaction.set(movRef, {
      productId,
      tipo,
      cantidad,
      cantidadAnterior,
      cantidadNueva,
      motivo: motivo ?? null,
      referencia: referencia ?? null,
      usuarioId: usuarioId ?? 'system',
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Para recibir traspaso: mismo id de documento en destino, o un único producto activo con el mismo SKU.
 */
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
