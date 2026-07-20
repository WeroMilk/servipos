import { useCallback, useEffect, useState } from 'react';
import type { Promotion } from '@/types';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import {
  createPromotionFirestore,
  deletePromotionFirestore,
  getPromotionsCatalogSnapshot,
  subscribePromotionsCatalog,
  updatePromotionFirestore,
  type PromotionInput,
} from '@/lib/firestore/promotionsFirestore';

export function usePromotions() {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [promotions, setPromotions] = useState<Promotion[]>(() => getPromotionsCatalogSnapshot());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveSucursalId) {
      setPromotions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribePromotionsCatalog(effectiveSucursalId, (rows) => {
      setPromotions(rows);
      setLoading(false);
    });
  }, [effectiveSucursalId]);

  const addPromotion = useCallback(
    async (data: PromotionInput) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      return createPromotionFirestore(effectiveSucursalId, data);
    },
    [effectiveSucursalId]
  );

  const patchPromotion = useCallback(
    async (id: string, updates: Partial<PromotionInput>) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      await updatePromotionFirestore(effectiveSucursalId, id, updates);
    },
    [effectiveSucursalId]
  );

  const removePromotion = useCallback(
    async (id: string) => {
      if (!effectiveSucursalId) throw new Error('Se requiere sucursal');
      await deletePromotionFirestore(effectiveSucursalId, id);
    },
    [effectiveSucursalId]
  );

  return { promotions, loading, addPromotion, patchPromotion, removePromotion, effectiveSucursalId };
}
