import type { Product } from '@/types';

function upperEs(s: string): string {
  return s.toLocaleUpperCase('es');
}

/** Nombre normalizado para comparar duplicados (mayúsculas, espacios colapsados). */
export function normalizeProductNombreKey(nombre: string): string {
  return upperEs(nombre.trim()).replace(/\s+/g, ' ');
}

export function normSkuBarcode(s: string): string {
  return upperEs((s ?? '').trim());
}

function catalogActivos(list: Product[]): Product[] {
  return list.filter((p) => p.activo !== false);
}

/**
 * Devuelve mensaje de error si nombre, SKU o código de barras chocan con otro producto activo.
 * SKU no puede repetirse con el código de barras de otro artículo y viceversa.
 * Códigos de barras vacíos no se consideran duplicados entre sí.
 */
export function productCatalogConflictMessage(
  allProducts: Product[],
  input: { nombre: string; sku: string; codigoBarras: string },
  excludeProductId?: string
): string | null {
  if (!input.nombre?.trim()) return 'El nombre es obligatorio.';
  const nombreK = normalizeProductNombreKey(input.nombre);
  if (!nombreK) return 'El nombre es obligatorio.';

  const skuU = normSkuBarcode(input.sku);
  if (!skuU) return 'El SKU es obligatorio.';

  const barU = normSkuBarcode(input.codigoBarras ?? '');

  const others = catalogActivos(allProducts).filter((p) => p.id !== excludeProductId);
  const lowerSku = skuU.toLowerCase();

  if (others.some((p) => normalizeProductNombreKey(p.nombre) === nombreK)) {
    return 'Ya existe un producto con ese nombre.';
  }
  if (others.some((p) => p.sku.toLowerCase() === lowerSku)) {
    return 'Ya existe un producto con ese SKU.';
  }
  if (barU) {
    if (others.some((p) => normSkuBarcode(p.codigoBarras ?? '') === barU)) {
      return 'Ese código de barras ya está registrado.';
    }
    if (others.some((p) => p.sku.toLowerCase() === barU.toLowerCase())) {
      return 'Ese código de barras coincide con el SKU de otro producto.';
    }
  }
  if (others.some((p) => normSkuBarcode(p.codigoBarras ?? '').toLowerCase() === lowerSku)) {
    return 'Ese SKU coincide con el código de barras de otro producto.';
  }
  return null;
}
