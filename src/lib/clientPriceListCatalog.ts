import {
  BUILTIN_CLIENT_PRICE_LIST_ORDER,
  CLIENT_PRICE_LABELS,
  type ClientPriceListId,
} from '@/lib/clientPriceLists';
import { useInventoryListsStore } from '@/stores/inventoryListsStore';

export type ClientPriceListEntry = {
  id: ClientPriceListId;
  label: string;
  builtin: boolean;
};

export function slugClientPriceListNombre(nombre: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (!slug) return `lista_${Date.now().toString(36)}`;
  if ((BUILTIN_CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(slug)) {
    return `extra_${slug}`;
  }
  return slug;
}

/** Listas fijas (5) + extras definidas en Configuración → Inventario (una etiqueta por línea). */
export function getClientPriceListCatalog(extraNombres: readonly string[] = []): {
  entries: ClientPriceListEntry[];
  ids: ClientPriceListId[];
  labels: Record<string, string>;
} {
  const entries: ClientPriceListEntry[] = BUILTIN_CLIENT_PRICE_LIST_ORDER.map((id) => ({
    id,
    label: CLIENT_PRICE_LABELS[id],
    builtin: true,
  }));
  const seen = new Set<string>(BUILTIN_CLIENT_PRICE_LIST_ORDER);

  for (const raw of extraNombres) {
    const label = raw.trim();
    if (!label) continue;
    const labelKey = label.toLowerCase();
    if (entries.some((e) => e.label.toLowerCase() === labelKey)) continue;

    let id = slugClientPriceListNombre(label);
    let n = 2;
    while (seen.has(id)) {
      id = `${slugClientPriceListNombre(label)}_${n}`;
      n += 1;
    }
    seen.add(id);
    entries.push({ id, label, builtin: false });
  }

  const ids = entries.map((e) => e.id);
  const labels = Object.fromEntries(entries.map((e) => [e.id, e.label]));
  return { entries, ids, labels };
}

export function isBuiltinClientPriceListId(id: string): boolean {
  return (BUILTIN_CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(id);
}

export function normalizeClientPriceListIdWithExtras(
  raw: unknown,
  extraNombres: readonly string[] = []
): ClientPriceListId {
  const { ids } = getClientPriceListCatalog(extraNombres);
  const s = String(raw ?? '').trim();
  if (s && ids.includes(s)) return s;
  return 'regular';
}

export function clientPriceListLabel(
  id: string,
  extraNombres: readonly string[] = []
): string {
  const { labels } = getClientPriceListCatalog(extraNombres);
  return labels[id] ?? id;
}

/** Catálogo efectivo usando el store de listas de inventario (para módulos no-React). */
export function getClientPriceListCatalogFromStore() {
  return getClientPriceListCatalog(useInventoryListsStore.getState().listasPrecioExtra);
}
