import type { Product, StockEntradaMeta } from '@/types';
import {
  parsePrecioNumberFromFirestore,
  parsePreciosPorListaClienteRaw,
  resolvePrecioVentaSinIvaForDoc,
  pickBestPrecioVentaRawFromFirestoreDoc,
  coalescePreciosPorListaClienteInputs,
} from '@/lib/precioListaNorm';
import { normalizeClaveUnidadSat, resolveClaveProdServ } from '@/lib/satCatalog';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
import { getSupabase } from '@/lib/supabaseClient';
import {
  buildProductSearchIndex,
  findProductByBarcodeInIndex,
  type ProductSearchIndex,
} from '@/lib/productSearchIndex';

/** PostgREST devuelve como máximo 1000 filas por defecto; hay que paginar. */
const PRODUCTS_FETCH_PAGE = 1000;

const CATALOG_FETCH_MAX_ATTEMPTS = 4;

function isTransientCatalogNetworkError(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (m.includes('failed to fetch')) return true;
  if (m.includes('networkerror')) return true;
  if (m.includes('network request failed')) return true;
  if (m.includes('load failed')) return true;
  if (m.includes('fetch aborted') || m.includes('aborted fetch')) return true;
  if (m.includes('timeout') || m.includes('timed out')) return true;
  if (m.includes('econnreset') || m.includes('econnrefused') || m.includes('enotfound')) return true;
  if (m.includes('bad gateway') || m.includes('service unavailable')) return true;
  if (/^5\d{2}\b/.test(m)) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllProductRowsForSucursalOnce(
  sucursalId: string,
  options?: { includeInactive?: boolean }
): Promise<{
  rows: { id: string; doc: Record<string, unknown> }[];
  error: Error | null;
}> {
  const supabase = getSupabase();
  const all: { id: string; doc: Record<string, unknown> }[] = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from('products')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (!options?.includeInactive) {
      query = query.or('doc->>activo.is.null,doc->>activo.neq.false');
    }
    const { data, error } = await query.order('id', { ascending: true }).range(from, from + PRODUCTS_FETCH_PAGE - 1);
    if (error) {
      console.error('Supabase products:', error);
      return { rows: [], error: new Error(error.message) };
    }
    const rows = (data ?? []) as { id: string; doc: Record<string, unknown> }[];
    all.push(...rows);
    if (rows.length < PRODUCTS_FETCH_PAGE) break;
    from += PRODUCTS_FETCH_PAGE;
  }
  return { rows: all, error: null };
}

const PRODUCT_COPY_UPSERT_BATCH = 200;

/**
 * Copia todos los registros de `products` de una sucursal a otra (mismo id de producto, precios y existencias).
 * No copia movimientos de inventario ni otros documentos.
 */
export async function copyProductCatalogBetweenSucursales(
  destSucursalId: string,
  sourceSucursalId: string
): Promise<{ copied: number }> {
  if (destSucursalId === sourceSucursalId) {
    throw new Error('El origen y el destino de la copia no pueden ser la misma sucursal.');
  }
  const { rows, error } = await fetchAllProductRowsForSucursal(sourceSucursalId, { includeInactive: true });
  if (error) throw error;
  if (rows.length === 0) {
    return { copied: 0 };
  }

  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const payload = rows.map((r) => {
    const doc = structuredClone(r.doc) as Record<string, unknown>;
    doc.updatedAt = nowIso;
    return {
      sucursal_id: destSucursalId,
      id: r.id,
      doc,
      updated_at: nowIso,
    };
  });

  for (let i = 0; i < payload.length; i += PRODUCT_COPY_UPSERT_BATCH) {
    const chunk = payload.slice(i, i + PRODUCT_COPY_UPSERT_BATCH);
    const { error: upErr } = await supabase.from('products').upsert(chunk, {
      onConflict: 'sucursal_id,id',
    });
    if (upErr) throw new Error(upErr.message);
  }

  return { copied: rows.length };
}

async function fetchAllProductRowsForSucursal(
  sucursalId: string,
  options?: { includeInactive?: boolean }
): Promise<{
  rows: { id: string; doc: Record<string, unknown> }[];
  error: Error | null;
}> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < CATALOG_FETCH_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoff = Math.round(350 * Math.pow(2.5, attempt - 1));
      await delay(backoff);
    }
    const { rows, error } = await fetchAllProductRowsForSucursalOnce(sucursalId, options);
    if (!error) {
      return { rows, error: null };
    }
    lastErr = error;
    if (!isTransientCatalogNetworkError(error.message)) {
      break;
    }
    console.warn(
      `[products] Fallo red al cargar catálogo (intento ${attempt + 1}/${CATALOG_FETCH_MAX_ATTEMPTS}):`,
      error.message
    );
  }
  return { rows: [], error: lastErr };
}

function firestoreTimestampToDate(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }
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

export function docToProduct(row: { id: string; doc: Record<string, unknown> }): Product {
  const d = row.doc;
  const rawPv = pickBestPrecioVentaRawFromFirestoreDoc(d);
  const rawPc = d.precioCompra ?? d.precio_compra;
  const impuesto = typeof d.impuesto === 'number' ? d.impuesto : Number(d.impuesto) || 16;
  const preciosListaIncluyenIva: boolean | undefined =
    d.preciosListaIncluyenIva === true ? true : d.preciosListaIncluyenIva === false ? false : undefined;
  const listaMerged =
    coalescePreciosPorListaClienteInputs(d.precios, d.preciosPorListaCliente) ?? d.preciosPorListaCliente;
  const parsedLista = parsePreciosPorListaClienteRaw(listaMerged);
  const precioVenta = resolvePrecioVentaSinIvaForDoc({
    rawPv,
    preciosPorListaCliente: parsedLista,
    preciosListaIncluyenIva,
    impuesto,
  });
  return {
    id: row.id,
    sku: String(d.sku ?? ''),
    codigoBarras: d.codigoBarras != null ? String(d.codigoBarras) : undefined,
    nombre: String(d.nombre ?? ''),
    descripcion: d.descripcion != null ? String(d.descripcion) : undefined,
    precioVenta,
    precioCompra: rawPc != null && String(rawPc).trim() !== '' ? parsePrecioNumberFromFirestore(rawPc) : undefined,
    impuesto,
    existencia: typeof d.existencia === 'number' ? d.existencia : Number(d.existencia) || 0,
    existenciaMinima:
      typeof d.existenciaMinima === 'number' ? d.existenciaMinima : Number(d.existenciaMinima) || 0,
    categoria: d.categoria != null ? String(d.categoria) : undefined,
    proveedor: d.proveedor != null ? String(d.proveedor) : undefined,
    preciosPorListaCliente: parsedLista,
    preciosListaIncluyenIva,
    imagen: d.imagen != null ? String(d.imagen) : undefined,
    unidadMedida: normalizeClaveUnidadSat(d.unidadMedida != null ? String(d.unidadMedida) : 'H87'),
    claveProdServ: resolveClaveProdServ(
      d.claveProdServ != null ? String(d.claveProdServ) : undefined
    ),
    esServicio: d.esServicio === true,
    ubicacionFisica: (() => {
      const u = d.ubicacionFisica != null ? String(d.ubicacionFisica).trim() : '';
      return u || undefined;
    })(),
    activo: d.activo !== false,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

function productToDocPayload(
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
    preciosListaIncluyenIva: product.preciosListaIncluyenIva ?? null,
    imagen: product.imagen ?? null,
    unidadMedida: normalizeClaveUnidadSat(product.unidadMedida),
    claveProdServ: resolveClaveProdServ(product.claveProdServ),
    esServicio: product.esServicio === true ? true : null,
    ubicacionFisica: product.ubicacionFisica?.trim() ? product.ubicacionFisica.trim() : null,
    activo: product.activo,
  };
}

let lastProducts: Product[] = [];
let lastSearchIndex: ProductSearchIndex = buildProductSearchIndex([]);
const catalogListeners = new Set<(products: Product[]) => void>();
const catalogErrorListeners = new Set<(err: Error) => void>();
let catalogChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let catalogSucursalId: string | null = null;
let catalogReloadDebounced: (() => void) | null = null;
let catalogInitialLoadDone = false;

function rebuildSearchIndex(): void {
  lastSearchIndex = buildProductSearchIndex(lastProducts);
}

function notifyCatalogListeners(): void {
  const snapshot = [...lastProducts];
  catalogListeners.forEach((l) => {
    try {
      l(snapshot);
    } catch (e) {
      console.error('subscribeProductCatalog listener:', e);
    }
  });
}

function applyProductRealtimePatch(payload: {
  eventType: string;
  new: { id?: string; doc?: Record<string, unknown> } | null;
  old: { id?: string } | null;
}): boolean {
  if (!catalogInitialLoadDone) return false;

  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return false;
    const before = lastProducts.length;
    lastProducts = lastProducts.filter((p) => p.id !== id);
    if (lastProducts.length !== before) {
      rebuildSearchIndex();
      return true;
    }
    return false;
  }

  const row = payload.new;
  if (!row?.id || !row.doc || typeof row.doc !== 'object') return false;
  const product = docToProduct({ id: row.id, doc: row.doc });
  if (product.activo === false) {
    const had = lastProducts.some((p) => p.id === row.id);
    if (!had) return false;
    lastProducts = lastProducts.filter((p) => p.id !== row.id);
    rebuildSearchIndex();
    return true;
  }

  const idx = lastProducts.findIndex((p) => p.id === row.id);
  if (idx >= 0) {
    lastProducts[idx] = product;
  } else {
    lastProducts.push(product);
  }
  rebuildSearchIndex();
  return true;
}

export function getProductCatalogSnapshot(): Product[] {
  return lastProducts;
}

export function getProductSearchIndex(): ProductSearchIndex {
  return lastSearchIndex;
}

export function isProductCatalogReady(): boolean {
  return catalogInitialLoadDone;
}

export function subscribeProductCatalog(
  sucursalId: string,
  onProducts: (products: Product[]) => void,
  onError?: (err: Error) => void
): () => void {
  try {
    onProducts([...lastProducts]);
  } catch (e) {
    console.error('subscribeProductCatalog (initial):', e);
  }
  catalogListeners.add(onProducts);
  if (onError) catalogErrorListeners.add(onError);

  const supabase = getSupabase();

  const load = async () => {
    const { rows, error } = await fetchAllProductRowsForSucursal(sucursalId);
    if (error) {
      if (lastProducts.length > 0) {
        catalogListeners.forEach((l) => {
          try {
            l([...lastProducts]);
          } catch (e) {
            console.error('subscribeProductCatalog listener:', e);
          }
        });
      }
      catalogErrorListeners.forEach((fn) => {
        try {
          fn(error);
        } catch (e) {
          console.error(fn, e);
        }
      });
      return;
    }
    lastProducts = rows.map((r) => docToProduct(r));
    catalogInitialLoadDone = true;
    rebuildSearchIndex();
    notifyCatalogListeners();
  };

  if (catalogSucursalId !== sucursalId) {
    if (catalogChannel) {
      void supabase.removeChannel(catalogChannel);
      catalogChannel = null;
    }
    catalogSucursalId = sucursalId;
    catalogInitialLoadDone = false;
    catalogReloadDebounced = createDebouncedAsyncFn(load, 600);
    void load();
    catalogChannel = supabase
      .channel(`products-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `sucursal_id=eq.${sucursalId}` },
        (payload) => {
          if (applyProductRealtimePatch(payload)) {
            notifyCatalogListeners();
            return;
          }
          catalogReloadDebounced?.();
        }
      )
      .subscribe();
  } else {
    /** Ya hay canal y datos para esta sucursal: no repetir fetch completo por cada nuevo suscriptor. */
    try {
      onProducts([...lastProducts]);
    } catch (e) {
      console.error('subscribeProductCatalog (resync existing):', e);
    }
  }

  return () => {
    catalogListeners.delete(onProducts);
    if (onError) catalogErrorListeners.delete(onError);
    // Mantener canal, índice y caché en sesión: evita refetch paginado al volver al POS.
  };
}

export async function createProductFirestore(
  sucursalId: string,
  product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const doc = {
    ...productToDocPayload(product),
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('products').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
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
  'esServicio',
] as const satisfies readonly (keyof Product)[];

export async function updateProductFirestore(
  sucursalId: string,
  productId: string,
  updates: Partial<Product>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row, error: ge } = await supabase
    .from('products')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', productId)
    .maybeSingle();
  if (ge) throw new Error(ge.message);
  const doc = { ...((row?.doc as Record<string, unknown>) ?? {}) };
  const now = new Date().toISOString();
  for (const k of PRODUCT_UPDATE_KEYS) {
    if (k in updates && updates[k] !== undefined) {
      (doc as Record<string, unknown>)[k] = updates[k];
    }
  }
  if ('codigoBarras' in updates) {
    const v = updates.codigoBarras;
    doc.codigoBarras = v && v.length > 0 ? v : null;
  }
  if ('claveProdServ' in updates) {
    doc.claveProdServ = resolveClaveProdServ(updates.claveProdServ);
  }
  if ('ubicacionFisica' in updates) {
    const u = updates.ubicacionFisica?.trim() ?? '';
    doc.ubicacionFisica = u || null;
  }
  if ('preciosPorListaCliente' in updates && updates.preciosPorListaCliente !== undefined) {
    const m = updates.preciosPorListaCliente;
    doc.preciosPorListaCliente = m && Object.keys(m).length > 0 ? m : null;
  }
  doc.updatedAt = now;
  const { error } = await supabase
    .from('products')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', productId);
  if (error) throw new Error(error.message);
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
  const supabase = getSupabase();
  const meta =
    entradaMeta != null
      ? {
          proveedor: entradaMeta.proveedor,
          proveedorCodigo: entradaMeta.proveedorCodigo,
          precioUnitarioCompra: entradaMeta.precioUnitarioCompra,
        }
      : null;
  const { error } = await supabase.rpc('rpc_adjust_stock', {
    p_sucursal_id: sucursalId,
    p_product_id: productId,
    p_cantidad: cantidad,
    p_tipo: tipo,
    p_motivo: motivo ?? null,
    p_referencia: referencia ?? null,
    p_usuario_id: usuarioId ?? 'system',
    p_entrada_meta: meta,
  });
  if (error) throw new Error(error.message);
}

export async function ensureProductAtDestForTransfer(
  destSucursalId: string,
  origenSucursalId: string,
  productIdOrigen: string,
  fallback: { nombre: string; sku: string; codigoBarras?: string }
): Promise<string> {
  const supabase = getSupabase();
  const { data: destRow } = await supabase
    .from('products')
    .select('doc')
    .eq('sucursal_id', destSucursalId)
    .eq('id', productIdOrigen)
    .maybeSingle();
  /** Mismo id en destino: solo se sumará existencia en el RPC (no reemplazar ficha). */
  if (destRow?.doc != null && typeof destRow.doc === 'object') {
    return productIdOrigen;
  }

  const { data: orig } = await supabase
    .from('products')
    .select('doc')
    .eq('sucursal_id', origenSucursalId)
    .eq('id', productIdOrigen)
    .maybeSingle();
  const ts = new Date().toISOString();
  const originOd = orig?.doc as Record<string, unknown> | undefined;
  const cbFromLine = (fallback.codigoBarras ?? '').trim();
  const cbFromOrigin =
    originOd?.codigoBarras != null && String(originOd.codigoBarras).trim() !== ''
      ? String(originOd.codigoBarras).trim()
      : '';
  const pidLinked = await resolveDestProductIdForTransfer(
    destSucursalId,
    productIdOrigen,
    fallback.sku,
    cbFromLine || cbFromOrigin || null
  );
  if (pidLinked) return pidLinked;

  let doc: Record<string, unknown>;
  if (originOd) {
    const od = originOd;
    doc = {
      sku: String(od.sku ?? fallback.sku ?? '').trim() || `T-${productIdOrigen.slice(0, 8)}`,
      codigoBarras: od.codigoBarras != null ? String(od.codigoBarras) : null,
      nombre: String(od.nombre ?? fallback.nombre).trim() || fallback.nombre,
      descripcion: od.descripcion != null ? String(od.descripcion) : null,
      precioVenta: parsePrecioNumberFromFirestore(pickBestPrecioVentaRawFromFirestoreDoc(od)),
      precioCompra:
        od.precioCompra != null && String(od.precioCompra).trim() !== ''
          ? parsePrecioNumberFromFirestore(od.precioCompra ?? od.precio_compra)
          : null,
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
      esServicio: od.esServicio === true ? true : null,
      activo: true,
      createdAt: ts,
      updatedAt: ts,
    };
  } else {
    const sku =
      (fallback.sku ?? '').trim() || `T-${productIdOrigen.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'SKU'}`;
    doc = {
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
    };
  }
  const { error } = await supabase.from('products').upsert({
    sucursal_id: destSucursalId,
    id: productIdOrigen,
    doc,
    updated_at: ts,
  });
  if (error) throw new Error(error.message);
  return productIdOrigen;
}

export async function resolveDestProductIdForTransfer(
  destSucursalId: string,
  productIdOrigen: string,
  sku: string,
  codigoBarras?: string | null
): Promise<string | null> {
  const supabase = getSupabase();
  const { data: byId } = await supabase
    .from('products')
    .select('id, doc')
    .eq('sucursal_id', destSucursalId)
    .eq('id', productIdOrigen)
    .maybeSingle();
  if (byId?.doc != null && typeof byId.doc === 'object') {
    return byId.id;
  }
  const sk = (sku ?? '').trim();
  const barKey = normSkuBarcode(codigoBarras ?? '');

  const { rows: allRows, error: fe } = await fetchAllProductRowsForSucursal(destSucursalId);
  if (fe) return null;

  const rowMatchesSku = (doc: Record<string, unknown>) =>
    sk !== '' && String((doc as { sku?: string }).sku ?? '').trim() === sk;

  const rowMatchesBarcode = (doc: Record<string, unknown>) => {
    if (!barKey) return false;
    const dBar = normSkuBarcode(String((doc as { codigoBarras?: string }).codigoBarras ?? ''));
    const dSku = normSkuBarcode(String((doc as { sku?: string }).sku ?? ''));
    return dBar === barKey || dSku === barKey;
  };

  const skuMatches = allRows.filter((r) => rowMatchesSku(r.doc));
  if (skuMatches.length === 1) return skuMatches[0]!.id;
  if (skuMatches.length > 1 && barKey) {
    const narrowed = skuMatches.filter((r) => rowMatchesBarcode(r.doc));
    if (narrowed.length === 1) return narrowed[0]!.id;
  }

  const barMatches = allRows.filter((r) => rowMatchesBarcode(r.doc));
  if (skuMatches.length === 0 && barMatches.length === 1) return barMatches[0]!.id;

  return null;
}

export async function getProductByBarcodeFirestore(
  sucursalId: string,
  codigoLeido: string
): Promise<Product | null> {
  if (catalogSucursalId === sucursalId && catalogInitialLoadDone) {
    return findProductByBarcodeInIndex(lastSearchIndex, codigoLeido);
  }
  const { rows, error } = await fetchAllProductRowsForSucursal(sucursalId);
  if (error) return null;
  const key = normSkuBarcode(codigoLeido);
  if (!key) return null;

  const activo = (d: Record<string, unknown>) => (d as { activo?: boolean }).activo !== false;

  const byBarras = rows.find((r) => {
    if (!activo(r.doc)) return false;
    const bar = String((r.doc as { codigoBarras?: string }).codigoBarras ?? '');
    return normSkuBarcode(bar) === key;
  });
  if (byBarras) return docToProduct(byBarras as { id: string; doc: Record<string, unknown> });

  /** Mismo valor en SKU (p. ej. import sin llenar código de barras). */
  const bySku = rows.find((r) => {
    if (!activo(r.doc)) return false;
    const sku = String((r.doc as { sku?: string }).sku ?? '');
    return normSkuBarcode(sku) === key;
  });
  if (!bySku) return null;
  return docToProduct(bySku as { id: string; doc: Record<string, unknown> });
}
