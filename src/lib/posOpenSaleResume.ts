import type { CartItem, Client, Sale, SaleItem } from '@/types';
import { normalizeClientPriceListIdWithExtras } from '@/lib/clientPriceListCatalog';
import type { ClientPriceListId } from '@/lib/clientPriceLists';
import { getCartLineUnitSinIvaBase } from '@/lib/productListPricing';

/** Cantidades agregadas por `productId` (varias líneas del mismo SKU se suman). */
export function saleItemsQtyByProductId(lines: SaleItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    const id = String(l.productId ?? '').trim();
    if (!id) continue;
    m.set(id, (m.get(id) ?? 0) + (Number(l.cantidad) || 0));
  }
  return m;
}

/** Líneas de venta a partir del carrito actual (misma lógica que al crear venta abierta). */
export function buildPendingSaleLineItemsFromCart(
  items: CartItem[],
  listaId: ClientPriceListId
): SaleItem[] {
  return items.map((item) => {
    const unitBase = getCartLineUnitSinIvaBase(item, listaId);
    const sub = unitBase * item.quantity * (1 - (Number(item.discount) || 0) / 100);
    return {
      id: crypto.randomUUID(),
      productId: item.product.id,
      productoNombre: item.product.nombre?.trim() || undefined,
      cantidad: item.quantity,
      precioUnitario: unitBase,
      descuento: Number(item.discount) || 0,
      impuesto: item.product.impuesto,
      subtotal: sub,
      total: sub * (1 + item.product.impuesto / 100),
      ...(item.promoId
        ? { promoId: item.promoId, promoLabel: item.promoLabel }
        : {}),
    };
  });
}

export function parseResumeListaPreciosId(sale: Sale): ClientPriceListId {
  return normalizeClientPriceListIdWithExtras(sale.posResumeListaPrecios);
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

