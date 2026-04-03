import type { Product } from '@/types';

/** Valor por defecto desde configuración fiscal (sucursal); se actualiza en `useFiscalConfig`. */
let fiscalListaPreciosConIva: boolean | undefined;

export function setCatalogListaPreciosIncluyenIvaFromFiscal(
  fiscal: { preciosListaIncluyenIva?: boolean } | null | undefined
): void {
  fiscalListaPreciosConIva = fiscal?.preciosListaIncluyenIva;
}

/**
 * Si es true, los importes en `preciosPorListaCliente` vienen con IVA incluido
 * (se convierten a sin IVA con el % `product.impuesto`).
 * `product.preciosListaIncluyenIva` anula el valor fiscal cuando está definido.
 *
 * Por defecto (sin valor en config fiscal o sin cargar aún): **con IVA incluido** (`true`).
 * Solo si en la sucursal se guardó explícitamente `preciosListaIncluyenIva: false` se trata como sin IVA.
 */
export function effectiveListaPreciosIncluyenIva(product: Product): boolean {
  if (product.preciosListaIncluyenIva !== undefined) {
    return product.preciosListaIncluyenIva === true;
  }
  if (fiscalListaPreciosConIva === false) return false;
  return true;
}
