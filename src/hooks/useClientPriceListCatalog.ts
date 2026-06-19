import { useMemo } from 'react';
import { getClientPriceListCatalog } from '@/lib/clientPriceListCatalog';
import { useInventoryListsStore } from '@/stores';

export function useClientPriceListCatalog() {
  const listasPrecioExtra = useInventoryListsStore((s) => s.listasPrecioExtra);
  return useMemo(() => getClientPriceListCatalog(listasPrecioExtra), [listasPrecioExtra]);
}
