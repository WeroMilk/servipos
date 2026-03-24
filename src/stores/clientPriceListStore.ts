import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type ClientPriceListId,
  CLIENT_PRICE_LIST_ORDER,
  DEFAULT_CLIENT_PRICE_DISCOUNTS,
} from '@/lib/clientPriceLists';

type DiscountsMap = Record<ClientPriceListId, number>;

function buildDefaultDiscounts(): DiscountsMap {
  const o = {} as DiscountsMap;
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    o[id] = DEFAULT_CLIENT_PRICE_DISCOUNTS[id];
  }
  return o;
}

interface ClientPriceListState {
  discounts: DiscountsMap;
  setDiscount: (id: ClientPriceListId, pct: number) => void;
}

export const useClientPriceListStore = create<ClientPriceListState>()(
  persist(
    (set) => ({
      discounts: buildDefaultDiscounts(),
      setDiscount: (id, pct) =>
        set((s) => ({
          discounts: {
            ...s.discounts,
            [id]: Math.min(100, Math.max(0, Number(pct) || 0)),
          },
        })),
    }),
    {
      name: 'servipos-client-price-lists',
      partialize: (s) => ({ discounts: s.discounts }),
    }
  )
);

export function getListaPrecioClientePct(listId: ClientPriceListId): number {
  const d = useClientPriceListStore.getState().discounts[listId];
  if (typeof d === 'number' && !Number.isNaN(d)) {
    return Math.min(100, Math.max(0, d));
  }
  return DEFAULT_CLIENT_PRICE_DISCOUNTS[listId];
}
