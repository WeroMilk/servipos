import type { Product } from '@/types';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';
import { sortPosSearchList } from '@/lib/productSearchLocal';

export type ProductSearchIndex = {
  products: readonly Product[];
  namesLower: readonly string[];
  skusNorm: readonly string[];
  barsNorm: readonly string[];
};

const EMPTY_INDEX: ProductSearchIndex = {
  products: [],
  namesLower: [],
  skusNorm: [],
  barsNorm: [],
};

export function buildProductSearchIndex(products: Product[]): ProductSearchIndex {
  if (!Array.isArray(products) || products.length === 0) return EMPTY_INDEX;
  const active: Product[] = [];
  const namesLower: string[] = [];
  const skusNorm: string[] = [];
  const barsNorm: string[] = [];
  for (const p of products) {
    if (p.activo === false) continue;
    active.push(p);
    namesLower.push((p.nombre ?? '').toLowerCase());
    skusNorm.push(normSkuBarcode(String(p.sku ?? '')));
    barsNorm.push(normSkuBarcode(String(p.codigoBarras ?? '')));
  }
  return { products: active, namesLower, skusNorm, barsNorm };
}

export function searchProductIndex(
  index: ProductSearchIndex,
  rawQuery: string,
  maxResults?: number
): Product[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [...index.products];
  const lower = trimmed.toLowerCase();
  const normQ = normSkuBarcode(trimmed);
  const hits: Product[] = [];
  for (let i = 0; i < index.products.length; i++) {
    const nameL = index.namesLower[i]!;
    const skuN = index.skusNorm[i]!;
    const barN = index.barsNorm[i]!;
    if (
      nameL.includes(lower) ||
      skuN.includes(normQ) ||
      (normQ.length > 0 && barN.includes(normQ))
    ) {
      hits.push(index.products[i]!);
    }
  }
  const sorted = sortPosSearchList(hits, trimmed);
  if (maxResults != null && Number.isFinite(maxResults) && maxResults > 0) {
    return sorted.slice(0, maxResults);
  }
  return sorted;
}

export function findProductByBarcodeInIndex(
  index: ProductSearchIndex,
  codigoLeido: string
): Product | null {
  const key = normSkuBarcode(codigoLeido);
  if (!key) return null;
  for (let i = 0; i < index.products.length; i++) {
    if (index.skusNorm[i] === key || index.barsNorm[i] === key) {
      return index.products[i]!;
    }
  }
  return null;
}
