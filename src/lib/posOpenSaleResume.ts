import type { CartItem, Client, Sale } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, type ClientPriceListId } from '@/lib/clientPriceLists';
import { getCartLineUnitSinIvaBase } from '@/lib/productListPricing';

export function parseResumeListaPreciosId(sale: Sale): ClientPriceListId {
  const s = sale.posResumeListaPrecios;
  if (s && (CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(s)) {
    return s as ClientPriceListId;
  }
  return 'regular';
}

export function clientFromSaleForPos(sale: Sale): Client | null {
  if (sale.clienteId === 'mostrador') return null;
  const c = sale.cliente;
  if (c?.nombre?.trim()) {
    return {
      id: c.id || sale.clienteId,
      nombre: c.nombre,
      rfc: c.rfc,
      razonSocial: c.razonSocial,
      isMostrador: c.isMostrador === true,
      listaPreciosId: c.listaPreciosId,
      createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(),
      updatedAt: c.updatedAt instanceof Date ? c.updatedAt : new Date(),
      syncStatus: 'synced',
    };
  }
  return null;
}

/** Comprueba que el carrito coincide con la venta pendiente (mismas líneas y precios). */
export function cartMatchesOpenSale(
  sale: Sale,
  items: CartItem[],
  listaId: ClientPriceListId
): boolean {
  const lines = sale.productos ?? [];
  if (lines.length !== items.length) return false;
  for (const line of lines) {
    const it = items.find((i) => i.product.id === line.productId);
    if (!it) return false;
    if (it.quantity !== line.cantidad) return false;
    if (Math.abs((it.discount || 0) - (line.descuento || 0)) > 0.02) return false;
    const u = getCartLineUnitSinIvaBase(it, listaId);
    if (Math.abs(u - (Number(line.precioUnitario) || 0)) > 0.02) return false;
  }
  return true;
}
