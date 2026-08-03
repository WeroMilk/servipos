import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LowStockAlertBucket = {
  /** Ocultos del alert hasta que salgan de stock bajo y vuelvan a agotarse. */
  hiddenIds: string[];
  /** Marcados como pedidos a proveedor; se limpian al salir de stock bajo. */
  orderedIds: string[];
};

type LowStockAlertState = {
  bySucursal: Record<string, LowStockAlertBucket>;
  hideProduct: (sucursalKey: string, productId: string) => void;
  markOrdered: (sucursalKey: string, productIds: string[]) => void;
  /**
   * Quita de hidden/ordered los productos que ya no están en stock bajo
   * (llegaron / se reabastecieron). Al agotarse de nuevo reaparecen.
   */
  syncResolved: (sucursalKey: string, stillLowIds: readonly string[]) => void;
};

const EMPTY_BUCKET: LowStockAlertBucket = { hiddenIds: [], orderedIds: [] };

function ensureBucket(
  bySucursal: Record<string, LowStockAlertBucket>,
  key: string
): LowStockAlertBucket {
  return bySucursal[key] ?? EMPTY_BUCKET;
}

function uniq(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function lowStockAlertSucursalKey(sucursalId: string | null | undefined): string {
  const t = sucursalId?.trim();
  return t ? t : 'local';
}

export const useLowStockAlertStore = create<LowStockAlertState>()(
  persist(
    (set, get) => ({
      bySucursal: {},
      hideProduct: (sucursalKey, productId) => {
        if (!productId) return;
        const key = sucursalKey || 'local';
        const prev = ensureBucket(get().bySucursal, key);
        if (prev.hiddenIds.includes(productId)) return;
        set({
          bySucursal: {
            ...get().bySucursal,
            [key]: {
              ...prev,
              hiddenIds: [...prev.hiddenIds, productId],
            },
          },
        });
      },
      markOrdered: (sucursalKey, productIds) => {
        const ids = uniq(productIds);
        if (ids.length === 0) return;
        const key = sucursalKey || 'local';
        const prev = ensureBucket(get().bySucursal, key);
        set({
          bySucursal: {
            ...get().bySucursal,
            [key]: {
              ...prev,
              orderedIds: uniq([...prev.orderedIds, ...ids]),
            },
          },
        });
      },
      syncResolved: (sucursalKey, stillLowIds) => {
        const key = sucursalKey || 'local';
        const prev = ensureBucket(get().bySucursal, key);
        if (prev.hiddenIds.length === 0 && prev.orderedIds.length === 0) return;
        const still = new Set(stillLowIds);
        const hiddenIds = prev.hiddenIds.filter((id) => still.has(id));
        const orderedIds = prev.orderedIds.filter((id) => still.has(id));
        if (
          hiddenIds.length === prev.hiddenIds.length &&
          orderedIds.length === prev.orderedIds.length
        ) {
          return;
        }
        set({
          bySucursal: {
            ...get().bySucursal,
            [key]: { hiddenIds, orderedIds },
          },
        });
      },
    }),
    {
      name: 'servipos-low-stock-alerts',
      partialize: (s) => ({ bySucursal: s.bySucursal }),
    }
  )
);

export function selectLowStockBucket(
  state: LowStockAlertState,
  sucursalKey: string
): LowStockAlertBucket {
  return ensureBucket(state.bySucursal, sucursalKey);
}
