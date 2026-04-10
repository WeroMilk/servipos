import type { Product } from '@/types';
import {
  parsePrecioNumberFromFirestore,
  parsePreciosPorListaClienteRaw,
  resolvePrecioVentaSinIvaForDoc,
  pickBestPrecioVentaRawFromFirestoreDoc,
  coalescePreciosPorListaClienteInputs,
} from '@/lib/precioListaNorm';

/** Evita throws en sort/UI cuando IndexedDB u orígenes devuelven campos incompletos. */
export function coerceProduct(p: Product): Product {
  const rawDoc = p as unknown as Record<string, unknown>;
  const listaMerged =
    coalescePreciosPorListaClienteInputs(rawDoc.precios, p.preciosPorListaCliente) ??
    p.preciosPorListaCliente;
  const preciosPorListaCliente = parsePreciosPorListaClienteRaw(listaMerged);
  const preciosListaIncluyenIva =
    p.preciosListaIncluyenIva === true ? true : p.preciosListaIncluyenIva === false ? false : undefined;
  const impuesto = Number(p.impuesto);
  const precioVenta = resolvePrecioVentaSinIvaForDoc({
    rawPv: pickBestPrecioVentaRawFromFirestoreDoc(rawDoc) ?? rawDoc.precioVenta,
    preciosPorListaCliente,
    preciosListaIncluyenIva,
    impuesto: Number.isFinite(impuesto) ? impuesto : 16,
  });
  const existencia = Number(p.existencia);
  const existenciaMinima = Number(p.existenciaMinima);
  const precioCompraNum =
    p.precioCompra != null && String(p.precioCompra).trim() !== ''
      ? parsePrecioNumberFromFirestore(p.precioCompra)
      : NaN;
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
