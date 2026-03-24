import type { Product } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';

/** Evita throws en sort/UI cuando IndexedDB u orígenes devuelven campos incompletos. */
export function coerceProduct(p: Product): Product {
  const precioVenta = Number(p.precioVenta);
  const existencia = Number(p.existencia);
  const existenciaMinima = Number(p.existenciaMinima);
  const impuesto = Number(p.impuesto);
  const precioCompraNum = p.precioCompra != null ? Number(p.precioCompra) : NaN;
  let preciosPorListaCliente: Product['preciosPorListaCliente'] = undefined;
  const raw = p.preciosPorListaCliente;
  if (raw && typeof raw === 'object') {
    const out: Partial<Record<ClientPriceListId, number>> = {};
    for (const id of CLIENT_PRICE_LIST_ORDER) {
      const v = raw[id];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[id] = v;
    }
    preciosPorListaCliente = Object.keys(out).length > 0 ? out : undefined;
  }
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
  };
}

export function coerceProductList(list: Product[]): Product[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is Product => p != null && typeof p === 'object').map(coerceProduct);
}
