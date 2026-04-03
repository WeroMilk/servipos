import type { Product } from '@/types';
import { parsePreciosPorListaClienteRaw } from '@/lib/precioListaNorm';

/** Evita throws en sort/UI cuando IndexedDB u orígenes devuelven campos incompletos. */
export function coerceProduct(p: Product): Product {
  const precioVenta = Number(p.precioVenta);
  const existencia = Number(p.existencia);
  const existenciaMinima = Number(p.existenciaMinima);
  const impuesto = Number(p.impuesto);
  const precioCompraNum = p.precioCompra != null ? Number(p.precioCompra) : NaN;
  const preciosPorListaCliente = parsePreciosPorListaClienteRaw(p.preciosPorListaCliente);
  const preciosListaIncluyenIva =
    p.preciosListaIncluyenIva === true ? true : p.preciosListaIncluyenIva === false ? false : undefined;
  return {
    ...p,
    nombre: p.nombre != null ? String(p.nombre) : '',
    sku: p.sku != null ? String(p.sku) : '',
    precioVenta: Number.isFinite(precioVenta) ? precioVenta : 0,
    precioCompra: Number.isFinite(precioCompraNum) ? precioCompraNum : undefined,
    existencia: Number.isFinite(existencia) ? existencia : 0,
    existenciaMinima: Number.isFinite(existenciaMinima) ? existenciaMinima : 0,
    impuesto: Number.isFinite(impuesto) ? impuesto : 16,
    unidadMedida: p.unidadMedida != null ? String(p.unidadMedida) : 'H87',
    preciosPorListaCliente,
    preciosListaIncluyenIva,
  };
}

export function coerceProductList(list: Product[]): Product[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is Product => p != null && typeof p === 'object').map(coerceProduct);
}
