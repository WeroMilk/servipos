import { useState, useEffect, useCallback } from 'react';
import type { Product } from '@/types';
import {
  getProducts,
  getProductByBarcode,
  searchProducts,
  getLowStockProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '@/db/database';
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
import { reportHookFailure } from '@/lib/appEventLog';

// ============================================
// HOOK DE PRODUCTOS (Dexie local o Firestore por sucursal)
// ============================================

export function useProducts() {
  const { effectiveSucursalId: sucursalId } = useEffectiveSucursalId();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const unsub = subscribeProductCatalog(sucursalId, (p) => {
        setProducts(coerceProductList(p));
        setError(null);
        setLoading(false);
      });
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
  }, [sucursalId]);

  const refresh = useCallback(async () => {
    if (sucursalId) {
      return;
    }
    await loadProductsLocal();
  }, [sucursalId, loadProductsLocal]);

  const addProduct = async (
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>
  ) => {
    try {
      if (sucursalId) {
        const id = await createProductFirestore(sucursalId, product);
        return id;
      }
      const id = await createProduct(product);
      await loadProductsLocal();
      return id;
    } catch (err) {
      setError('Error al crear producto');
      throw err;
    }
  };

  const editProduct = async (id: string, updates: Partial<Product>) => {
    try {
      if (sucursalId) {
        await updateProductFirestore(sucursalId, id, updates);
        return;
      }
      await updateProduct(id, updates);
      await loadProductsLocal();
    } catch (err) {
      reportHookFailure('hook:useProducts', 'Actualizar producto', err);
      setError('Error al actualizar producto');
      throw err;
    }
  };

  const removeProduct = async (id: string) => {
    try {
      if (sucursalId) {
        await deleteProductFirestore(sucursalId, id);
        return;
      }
      await deleteProduct(id);
      await loadProductsLocal();
    } catch (err) {
      setError('Error al eliminar producto');
      throw err;
    }
  };

  const adjustStock = async (
    productId: string,
    cantidad: number,
    tipo: 'entrada' | 'salida' | 'ajuste',
    motivo?: string,
    referencia?: string,
    usuarioId?: string
  ) => {
    try {
      await updateStockUnified(sucursalId, productId, cantidad, tipo, motivo, referencia, usuarioId);
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
