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
import { useAuthStore } from '@/stores';

// ============================================
// HOOK DE PRODUCTOS (Dexie local o Firestore por sucursal)
// ============================================

export function useProducts() {
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProductsLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProducts();
      setProducts(data);
      setError(null);
    } catch (err) {
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
        setProducts(p);
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
          setProducts(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
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
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
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
          const data = getProductCatalogSnapshot().filter(
            (p) =>
              p.nombre.toLowerCase().includes(lower) ||
              p.sku.toLowerCase().includes(lower) ||
              (p.codigoBarras !== undefined && p.codigoBarras.includes(q))
          );
          setResults(data);
          return;
        }
        const data = await searchProducts(q);
        setResults(data);
      } catch (err) {
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
  const sucursalId = useAuthStore((s) => s.user?.sucursalId);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const filterLow = useCallback((list: Product[]) => {
    return list.filter((p) => p.activo === true && p.existencia <= p.existenciaMinima);
  }, []);

  const loadLowStockLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getLowStockProducts();
      setProducts(data);
    } catch (err) {
      console.error('Error al cargar productos con bajo stock:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sucursalId) {
      setLoading(true);
      const unsub = subscribeProductCatalog(sucursalId, (p) => {
        setProducts(filterLow(p));
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
