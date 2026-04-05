import { useState, useEffect, useCallback } from 'react';
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
  getProductByBarcodeFirestore,
} from '@/lib/firestore/productsFirestore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { coerceProductList } from '@/lib/productCoerce';
import {
  auditActorSuffix,
  diffProductCatalogUpdates,
  formatProductAltaMotivo,
  formatProductBajaMotivo,
} from '@/lib/inventoryCatalogAudit';
import { productCatalogConflictMessage } from '@/lib/productCatalogUniqueness';
import { reportHookFailure } from '@/lib/appEventLog';
import { useAuthStore } from '@/stores';
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
          setProducts(coerceProductList(p));
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

export function useProductSearch() {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sucursalId) return;
    return subscribeProductCatalog(sucursalId, () => {
      /* catálogo compartido */
    });
  }, [sucursalId]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }

      try {
        setLoading(true);
        if (sucursalId) {
          const lower = q.toLowerCase();
          const data = coerceProductList(getProductCatalogSnapshot()).filter(
            (p) =>
              p.nombre.toLowerCase().includes(lower) ||
              p.sku.toLowerCase().includes(lower) ||
              (p.codigoBarras !== undefined && p.codigoBarras.includes(q))
          );
          setResults(data);
          return;
        }
        const data = await searchProducts(q);
        setResults(coerceProductList(data));
      } catch (err) {
        reportHookFailure('hook:useProductSearch', 'Búsqueda de productos', err);
        console.error('Error en búsqueda:', err);
      } finally {
        setLoading(false);
      }
    },
    [sucursalId]
  );

  const searchByBarcode = useCallback(
    async (barcode: string) => {
      try {
        setLoading(true);
        if (sucursalId) {
          return (await getProductByBarcodeFirestore(sucursalId, barcode)) || null;
        }
        const product = await getProductByBarcode(barcode);
        return product || null;
      } catch (err) {
        reportHookFailure('hook:useProductSearch', 'Búsqueda por código de barras', err);
        console.error('Error al buscar por código:', err);
        return null;
      } finally {
        setLoading(false);
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
    return list.filter((p) => p.activo === true && p.existencia <= p.existenciaMinima);
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
        setProducts(filterLow(coerceProductList(p)));
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
