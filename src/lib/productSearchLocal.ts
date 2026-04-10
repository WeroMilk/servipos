import type { Product } from '@/types';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';

/** Misma heurística que el buscador del POS: nombre, SKU y código de barras. */
function posSearchRank(p: Product, needleLower: string, needleNorm: string): number {
  const nameL = (p.nombre ?? '').toLowerCase();
  const skuN = normSkuBarcode(String(p.sku ?? ''));
  const barN = normSkuBarcode(String(p.codigoBarras ?? ''));
  const exactOk = needleNorm.length >= 2;
  if (exactOk) {
    if (skuN === needleNorm) return 0;
    if (barN === needleNorm) return 1;
  }
  if (nameL.startsWith(needleLower)) return 2;
  if (exactOk && skuN.startsWith(needleNorm)) return 3;
  if (exactOk && barN.startsWith(needleNorm)) return 4;
  if (needleNorm && skuN.includes(needleNorm)) return 5;
  if (needleNorm && barN.includes(needleNorm)) return 6;
  if (nameL.includes(needleLower)) return 7;
  return 8;
}

function sortPosSearchList(list: Product[], q: string): Product[] {
  const needleLower = q.trim().toLowerCase();
  const needleNorm = normSkuBarcode(q);
  return [...list].sort((a, b) => {
    const ra = posSearchRank(a, needleLower, needleNorm);
    const rb = posSearchRank(b, needleLower, needleNorm);
    if (ra !== rb) return ra - rb;
    return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base' });
  });
}

/** Filtra y ordena el catálogo ya cargado en memoria (sin red ni segundo subscribe). */
export function filterProductsBySearchText(products: Product[], rawQuery: string): Product[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return products;
  const lower = trimmed.toLowerCase();
  const normQ = normSkuBarcode(trimmed);
  const raw = products.filter((p) => {
    if (p.activo === false) return false;
    const nameL = (p.nombre ?? '').toLowerCase();
    const skuN = normSkuBarcode(String(p.sku ?? ''));
    const barN = normSkuBarcode(String(p.codigoBarras ?? ''));
    return nameL.includes(lower) || skuN.includes(normQ) || (normQ.length > 0 && barN.includes(normQ));
  });
  return sortPosSearchList(raw, trimmed);
}
