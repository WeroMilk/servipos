import type { Product, StockEntradaMeta } from '@/types';
import {
  parsePrecioNumberFromFirestore,
  parsePreciosPorListaClienteRaw,
  resolvePrecioVentaSinIvaForDoc,
  pickBestPrecioVentaRawFromFirestoreDoc,
  coalescePreciosPorListaClienteInputs,
} from '@/lib/precioListaNorm';
import { normalizeClaveProdServ, normalizeClaveUnidadSat } from '@/lib/satCatalog';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';
import { getSupabase } from '@/lib/supabaseClient';

/** PostgREST devuelve como máximo 1000 filas por defecto; hay que paginar. */
const PRODUCTS_FETCH_PAGE = 1000;

async function fetchAllProductRowsForSucursal(sucursalId: string): Promise<{
  rows: { id: string; doc: Record<string, unknown> }[];
  error: Error | null;
}> {
  const supabase = getSupabase();
  const all: { id: string; doc: Record<string, unknown> }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, doc')
      .eq('sucursal_id', sucursalId)
      .order('id', { ascending: true })
      .range(from, from + PRODUCTS_FETCH_PAGE - 1);
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
    claveProdServ: (() => {
      const raw = d.claveProdServ != null ? String(d.claveProdServ).replace(/\D/g, '').slice(0, 8) : '';
      return raw.length === 8 ? raw : undefined;
    })(),
    esServicio: d.esServicio === true,
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
    claveProdServ:
      normalizeClaveProdServ(product.claveProdServ).length === 8
        ? normalizeClaveProdServ(product.claveProdServ)
        : null,
    esServicio: product.esServicio === true ? true : null,
    activo: product.activo,
  };
}

let lastProducts: Product[] = [];
const catalogListeners = new Set<(products: Product[]) => void>();
const catalogErrorListeners = new Set<(err: Error) => void>();
let catalogChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let catalogSucursalId: string | null = null;

export function getProductCatalogSnapshot(): Product[] {
  return lastProducts;
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
      lastProducts = [];
      catalogListeners.forEach((l) => l([]));
      catalogErrorListeners.forEach((fn) => {
        try {
          fn(error);
        } catch (e) {
          console.error(fn, e);
        }
      });
      return;
    }
    lastProducts = rows
      .filter((r) => r.doc && (r.doc as { activo?: boolean }).activo !== false)
      .map((r) => docToProduct(r))
      .sort((a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'));
    catalogListeners.forEach((l) => {
      try {
        l([...lastProducts]);
      } catch (e) {
        console.error('subscribeProductCatalog listener:', e);
      }
    });
  };

  if (catalogSucursalId !== sucursalId) {
    if (catalogChannel) {
      void supabase.removeChannel(catalogChannel);
      catalogChannel = null;
    }
    catalogSucursalId = sucursalId;
    void load();
    catalogChannel = supabase
      .channel(`products-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `sucursal_id=eq.${sucursalId}` },
        () => {
          void load();
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
    if (catalogListeners.size === 0) {
      if (catalogChannel) {
        void supabase.removeChannel(catalogChannel);
        catalogChannel = null;
      }
      catalogSucursalId = null;
      lastProducts = [];
      catalogErrorListeners.clear();
    }
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
    const n = normalizeClaveProdServ(updates.claveProdServ);
    doc.claveProdServ = n.length === 8 ? n : null;
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
