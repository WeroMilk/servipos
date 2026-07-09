import { useState, useEffect, useCallback } from 'react';
import type { GoodsExit, GoodsExitItem, GoodsExitMotivo } from '@/types';
import {
  getGoodsExits,
  createGoodsExit,
  generateGoodsExitFolio,
} from '@/db/database';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { reportHookFailure } from '@/lib/appEventLog';
import { applyGoodsExit } from '@/lib/goodsExitLogic';
import {
  createGoodsExitFirestore,
  subscribeGoodsExitsCatalog,
  getGoodsExitsCatalogSnapshot,
  generateGoodsExitFolioFirestore,
} from '@/lib/firestore/goodsExitsFirestore';
import { useProducts } from '@/hooks/useProducts';

export type RegisterGoodsExitInput = {
  motivo: GoodsExitMotivo;
  motivoDetalle?: string;
  destino?: string;
  notas?: string;
  usuarioId?: string;
  usuarioNombre?: string;
  productos: GoodsExitItem[];
};

export function useGoodsExits() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const { products, adjustStock } = useProducts();
  const [exits, setExits] = useState<GoodsExit[]>(() => {
    if (!effectiveSucursalId) return [];
    return getGoodsExitsCatalogSnapshot();
  });
  const [loading, setLoading] = useState(() => {
    if (!effectiveSucursalId) return true;
    return getGoodsExitsCatalogSnapshot().length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getGoodsExits(effectiveSucursalId);
      setExits(data);
      setError(null);
    } catch (err) {
      setError('Error al cargar salidas de mercancía');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    if (effectiveSucursalId) {
      const snap = getGoodsExitsCatalogSnapshot();
      if (snap.length === 0) {
        setLoading(true);
      } else {
        setExits(snap);
      }
      const unsub = subscribeGoodsExitsCatalog(effectiveSucursalId, (rows) => {
        setExits(rows);
        setError(null);
        setLoading(false);
      });
      return unsub;
    }
    void loadLocal();
  }, [effectiveSucursalId, loadLocal]);

  const registerExit = async (input: RegisterGoodsExitInput): Promise<GoodsExit | undefined> => {
    const productos = input.productos
      .map((it) => ({
        ...it,
        cantidad: Math.max(0, Math.floor(Number(it.cantidad) || 0)),
      }))
      .filter((it) => it.cantidad > 0);
    if (productos.length === 0) {
      throw new Error('Agregue al menos un producto con cantidad mayor a cero.');
    }

    const folio = effectiveSucursalId
      ? await generateGoodsExitFolioFirestore(effectiveSucursalId)
      : await generateGoodsExitFolio(effectiveSucursalId);

    await applyGoodsExit(
      {
        folio,
        motivo: input.motivo,
        motivoDetalle: input.motivoDetalle,
        destino: input.destino,
        productos,
        usuarioId: input.usuarioId,
      },
      {
        adjustStock,
        getProduct: (id) => products.find((p) => p.id === id),
      }
    );

    const payload = {
      folio,
      motivo: input.motivo,
      motivoDetalle: input.motivoDetalle?.trim() || undefined,
      destino: input.destino?.trim() || undefined,
      notas: input.notas?.trim() || undefined,
      productos,
      estado: 'completada' as const,
      sucursalId: effectiveSucursalId,
      usuarioId: input.usuarioId,
      usuarioNombre: input.usuarioNombre,
    };

    try {
      if (effectiveSucursalId) {
        return await createGoodsExitFirestore(effectiveSucursalId, payload);
      }
      const id = await createGoodsExit({ ...payload, folio });
      await loadLocal();
      return (await getGoodsExits(effectiveSucursalId)).find((g) => g.id === id);
    } catch (err) {
      reportHookFailure('hook:useGoodsExits', 'Registrar salida de mercancía', err);
      throw err;
    }
  };

  return {
    exits,
    loading,
    error,
    registerExit,
    products,
  };
}

export type { GoodsExitItem };
