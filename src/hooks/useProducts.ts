import { useState, useEffect, useCallback, useRef } from 'react';
import type { Product, StockEntradaMeta } from '@/types';
import {
  getProducts,
  getProductByBarcode,
  searchProducts,
  getLowStockProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '@/db/database';
import { appendCatalogInventoryMovement } from '@/data/catalogAuditBridge';
import { updateStockUnified } from '@/data/stockBridge';
import {
  subscribeProductCatalog,
  getProductCatalogSnapshot,
  createProductFirestore,
  updateProductFirestore,
  deleteProductFirestore,
} from '@/lib/firestore/productsFirestore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { coerceProductList } from '@/lib/productCoerce';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';
import { productEsServicio } from '@/lib/productServicio';
import {
  auditActorSuffix,
  diffProductCatalogUpdates,
  formatProductAltaMotivo,
  formatProductBajaMotivo,
} from '@/lib/inventoryCatalogAudit';
import { productCatalogConflictMessage } from '@/lib/productCatalogUniqueness';
import { reportHookFailure } from '@/lib/appEventLog';
import { useAuthStore, useCartStore } from '@/stores';
import { isRemotePermissionDenied, SUPABASE_PERMISSION_HINT } from '@/lib/remotePermissionError';

// ============================================
// HOOK DE PRODUCTOS (Dexie local o Firestore por sucursal)
// ============================================

export function useProducts() {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const catalogUsuarioId = useAuthStore((s) => s.user?.id ?? 'system');
  const catalogUserName = useAuthStore((s) => s.user?.name);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onCatalogFirestoreError = useCallback((err: unknown) => {
    reportHookFailure('hook:useProducts', 'Catálogo remoto (products)', err);
    if (isRemotePermissionDenied(err)) {
      setError(
        `Sin permiso para leer el inventario de esta sucursal. ${SUPABASE_PERMISSION_HINT}`
      );
    } else {
      setError(err instanceof Error ? err.message : 'Error al sincronizar inventario con la nube');
    }
    setProducts([]);
    setLoading(false);
  }, []);

  const loadProductsLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProducts();
      setProducts(coerceProductList(data));
      setError(null);
    } catch (err) {
      reportHookFailure('hook:useProducts', 'Cargar productos (local)', err);
      setError('Error al cargar productos');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sucursalId) {
      setLoading(true);
      setError(null);
      const unsub = subscribeProductCatalog(
        sucursalId,
        (p) => {
          /** `docToProduct` ya normaliza; evitar `coerceProduct` por fila (muy costoso en catálogos grandes). */
          setProducts(Array.isArray(p) ? p : []);
          setError(null);
          setLoading(false);
        },
        onCatalogFirestoreError
      );
      return unsub;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getProducts();
        if (!cancelled) {
          setProducts(coerceProductList(data));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          reportHookFailure('hook:useProducts', 'Cargar productos', err);
          setError('Error al cargar productos');
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sucursalId, onCatalogFirestoreError]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      return;
    }
    await loadProductsLocal();
  }, [sucursalId, loadProductsLocal]);

  const addProduct = useCallback(
    async (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => {
      const msg = productCatalogConflictMessage(products, {
        nombre: product.nombre,
        sku: product.sku,
        codigoBarras: product.codigoBarras ?? '',
      });
      if (msg) throw new Error(msg);
      try {
        let newId: string;
        if (sucursalId) {
          newId = await createProductFirestore(sucursalId, product);
        } else {
          newId = await createProduct(product);
          await loadProductsLocal();
        }
        try {
          await appendCatalogInventoryMovement(sucursalId, {
            productId: newId,
            tipo: 'producto_alta',
            motivo:
              formatProductAltaMotivo({
                nombre: product.nombre,
                sku: product.sku,
                codigoBarras: product.codigoBarras,
                precioVenta: product.precioVenta,
                precioCompra: product.precioCompra,
                impuesto: product.impuesto,
                existencia: product.existencia,
                existenciaMinima: product.existenciaMinima,
                proveedor: product.proveedor,
                categoria: product.categoria,
                unidadMedida: product.unidadMedida,
                descripcion: product.descripcion,
              }) + auditActorSuffix(catalogUsuarioId, catalogUserName),
            usuarioId: catalogUsuarioId,
            nombreRegistro: product.nombre,
            skuRegistro: product.sku,
          });
        } catch (auditErr) {
          reportHookFailure('hook:useProducts', 'Auditoría catálogo (alta)', auditErr);
        }
        return newId;
      } catch (err) {
        setError('Error al crear producto');
        throw err;
      }
    },
    [products, sucursalId, loadProductsLocal, catalogUsuarioId, catalogUserName]
  );

  const editProduct = useCallback(
    async (id: string, updates: Partial<Product>) => {
      const prev = products.find((p) => p.id === id);
      if (!prev) throw new Error('Producto no encontrado en el catálogo.');

      const touchesIdentity =
        updates.nombre !== undefined ||
        updates.sku !== undefined ||
        updates.codigoBarras !== undefined;

      if (touchesIdentity) {
        const mergedNombre = updates.nombre !== undefined ? updates.nombre : prev.nombre;
        const mergedSku = updates.sku !== undefined ? updates.sku : prev.sku;
        const mergedBar =
          updates.codigoBarras !== undefined ? (updates.codigoBarras ?? '') : (prev.codigoBarras ?? '');
        const msg = productCatalogConflictMessage(
          products,
          { nombre: mergedNombre, sku: mergedSku, codigoBarras: mergedBar },
          id
        );
        if (msg) throw new Error(msg);
      }

      try {
        if (sucursalId) {
          await updateProductFirestore(sucursalId, id, updates);
        } else {
          await updateProduct(id, updates);
          await loadProductsLocal();
        }

        const lines = diffProductCatalogUpdates(prev, updates);
        if (lines.length > 0) {
          try {
            await appendCatalogInventoryMovement(sucursalId, {
              productId: id,
              tipo: 'producto_edicion',
              motivo: lines.join('\n') + auditActorSuffix(catalogUsuarioId, catalogUserName),
              usuarioId: catalogUsuarioId,
              nombreRegistro: prev.nombre,
              skuRegistro: prev.sku,
            });
          } catch (auditErr) {
            reportHookFailure('hook:useProducts', 'Auditoría catálogo (edición)', auditErr);
          }
        }
      } catch (err) {
        reportHookFailure('hook:useProducts', 'Actualizar producto', err);
        setError('Error al actualizar producto');
        throw err;
      }
    },
    [products, sucursalId, loadProductsLocal, catalogUsuarioId, catalogUserName]
  );

  const removeProduct = useCallback(
    async (id: string) => {
      const prev = products.find((p) => p.id === id);
      try {
        if (sucursalId) {
          await deleteProductFirestore(sucursalId, id);
        } else {
          await deleteProduct(id);
          await loadProductsLocal();
        }
        if (prev) {
          try {
            await appendCatalogInventoryMovement(sucursalId, {
              productId: id,
              tipo: 'producto_baja',
              motivo: formatProductBajaMotivo(prev) + auditActorSuffix(catalogUsuarioId, catalogUserName),
              usuarioId: catalogUsuarioId,
              nombreRegistro: prev.nombre,
              skuRegistro: prev.sku,
            });
          } catch (auditErr) {
            reportHookFailure('hook:useProducts', 'Auditoría catálogo (baja)', auditErr);
          }
        }
      } catch (err) {
        setError('Error al eliminar producto');
        throw err;
      }
    },
    [products, sucursalId, loadProductsLocal, catalogUsuarioId, catalogUserName]
  );

  const adjustStock = async (
    productId: string,
    cantidad: number,
    tipo: 'entrada' | 'salida' | 'ajuste',
    motivo?: string,
    referencia?: string,
    usuarioId?: string,
    entradaMeta?: StockEntradaMeta
  ) => {
    try {
      await updateStockUnified(
        sucursalId,
        productId,
        cantidad,
        tipo,
        motivo,
        referencia,
        usuarioId,
        entradaMeta
      );
      if (!sucursalId) {
        await loadProductsLocal();
      }
    } catch (err) {
      reportHookFailure('hook:useProducts', 'Ajustar stock', err);
      setError('Error al ajustar stock');
      throw err;
    }
  };

  return {
    products,
    loading,
    error,
    refresh,
    addProduct,
    editProduct,
    removeProduct,
    adjustStock,
  };
}

function posSearchRank(p: Product, needleLower: string, needleNorm: string): number {
  const nameL = (p.nombre ?? '').toLowerCase();
  const skuN = normSkuBarcode(String(p.sku ?? ''));
  const barN = normSkuBarcode(String(p.codigoBarras ?? ''));
  const exactOk = needleNorm.length >= 2;
  if (exactOk) {
    if (skuN === needleNorm) return 0;
    if (barN === needleNorm) return 1;
  }
  if (nameL.startsWith(needleLower)) return 2;
  if (exactOk && skuN.startsWith(needleNorm)) return 3;
  if (exactOk && barN.startsWith(needleNorm)) return 4;
  if (needleNorm && skuN.includes(needleNorm)) return 5;
  if (needleNorm && barN.includes(needleNorm)) return 6;
  if (nameL.includes(needleLower)) return 7;
  return 8;
}

function sortPosSearchList(list: Product[], q: string): Product[] {
  const needleLower = q.trim().toLowerCase();
  const needleNorm = normSkuBarcode(q);
  return [...list].sort((a, b) => {
    const ra = posSearchRank(a, needleLower, needleNorm);
    const rb = posSearchRank(b, needleLower, needleNorm);
    if (ra !== rb) return ra - rb;
    return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base' });
  });
}

/** `maxResults` (p. ej. 80 en POS) evita listas enormes y mantiene la UI fluida; sin tope en inventario u otros usos. */
export function useProductSearch(options?: { maxResults?: number }) {
  const maxCap = options?.maxResults;
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const searchGenRef = useRef(0);
  const reconcileCartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sucursalId) return;
    const unsub = subscribeProductCatalog(sucursalId, (products) => {
      if (reconcileCartTimerRef.current != null) {
        window.clearTimeout(reconcileCartTimerRef.current);
      }
      reconcileCartTimerRef.current = window.setTimeout(() => {
        reconcileCartTimerRef.current = null;
        useCartStore.getState().reconcileCartProductsFromCatalog(products);
      }, 48);
    });
    return () => {
      unsub();
      if (reconcileCartTimerRef.current != null) {
        window.clearTimeout(reconcileCartTimerRef.current);
        reconcileCartTimerRef.current = null;
      }
    };
  }, [sucursalId]);

  const search = useCallback(
    async (q: string): Promise<Product[]> => {
      const trimmed = q.trim();
      if (!trimmed) {
        searchGenRef.current += 1;
        setResults([]);
        setLoading(false);
        return [];
      }

      const gen = ++searchGenRef.current;
      try {
        setLoading(true);
        if (sucursalId) {
          const lower = trimmed.toLowerCase();
          const normQ = normSkuBarcode(trimmed);
          const raw = coerceProductList(getProductCatalogSnapshot()).filter((p) => {
            if (p.activo === false) return false;
            const nameL = (p.nombre ?? '').toLowerCase();
            const skuN = normSkuBarcode(String(p.sku ?? ''));
            const barN = normSkuBarcode(String(p.codigoBarras ?? ''));
            return (
              nameL.includes(lower) ||
              skuN.includes(normQ) ||
              (normQ.length > 0 && barN.includes(normQ))
            );
          });
          const sorted = sortPosSearchList(raw, trimmed);
          const data =
            maxCap != null && Number.isFinite(maxCap) && maxCap > 0
              ? sorted.slice(0, maxCap)
              : sorted;
          if (gen !== searchGenRef.current) return data;
          setResults(data);
          return data;
        }
        const data = await searchProducts(trimmed);
        const sorted = sortPosSearchList(coerceProductList(data), trimmed);
        const list =
          maxCap != null && Number.isFinite(maxCap) && maxCap > 0
            ? sorted.slice(0, maxCap)
            : sorted;
        if (gen !== searchGenRef.current) return list;
        setResults(list);
        return list;
      } catch (err) {
        reportHookFailure('hook:useProductSearch', 'Búsqueda de productos', err);
        console.error('Error en búsqueda:', err);
        if (gen === searchGenRef.current) setResults([]);
        return [];
      } finally {
        if (gen === searchGenRef.current) setLoading(false);
      }
    },
    [sucursalId, maxCap]
  );

  const searchByBarcode = useCallback(
    async (barcode: string) => {
      try {
        if (sucursalId) {
          /** Catálogo ya en memoria (misma fuente que la búsqueda por texto): evita un fetch completo por cada pistola. */
          const list = coerceProductList(getProductCatalogSnapshot());
          const key = normSkuBarcode(barcode);
          if (!key) return null;
          const ok = (p: Product) => p.activo !== false;
          const byBar = list.find(
            (p) => ok(p) && normSkuBarcode(String(p.codigoBarras ?? '')) === key
          );
          if (byBar) return byBar;
          const bySku = list.find((p) => ok(p) && normSkuBarcode(String(p.sku ?? '')) === key);
          return bySku ?? null;
        }
        setLoading(true);
        const product = await getProductByBarcode(barcode);
        return product || null;
      } catch (err) {
        reportHookFailure('hook:useProductSearch', 'Búsqueda por código de barras', err);
        console.error('Error al buscar por código:', err);
        return null;
      } finally {
        if (!sucursalId) setLoading(false);
      }
    },
    [sucursalId]
  );

  return { results, loading, search, searchByBarcode };
}

export function useLowStockProducts() {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const filterLow = useCallback((list: Product[]) => {
    return list.filter(
      (p) =>
        p.activo === true &&
        !productEsServicio(p) &&
        p.existencia <= p.existenciaMinima
    );
  }, []);

  const loadLowStockLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getLowStockProducts();
      setProducts(coerceProductList(data));
    } catch (err) {
      reportHookFailure('hook:useLowStockProducts', 'Cargar stock bajo', err);
      console.error('Error al cargar productos con bajo stock:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sucursalId) {
      setLoading(true);
      const unsub = subscribeProductCatalog(sucursalId, (p) => {
        setProducts(filterLow(Array.isArray(p) ? p : []));
        setLoading(false);
      });
      return unsub;
    }

    loadLowStockLocal();
  }, [sucursalId, filterLow, loadLowStockLocal]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      return;
    }
    await loadLowStockLocal();
  }, [sucursalId, loadLowStockLocal]);

  return { products, loading, refresh };
}
