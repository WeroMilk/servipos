import type { CartItem, Product } from '@/types';
import { productEsServicio } from '@/lib/productServicio';

export function stockFisicoProducto(product: Product | null | undefined): number {
  if (!product || productEsServicio(product)) return Number.POSITIVE_INFINITY;
  const n = Number(product.existencia);
  return Number.isFinite(n) ? n : 0;
}

export function cartQtyForProduct(items: CartItem[], productId: string): number {
  const line = items.find((i) => i.product.id === productId);
  return Number(line?.quantity) || 0;
}

/** True si la cantidad pedida en carrito supera lo que hay en anaquel. */
export function ventaExcedeExistencia(opts: {
  product: Product;
  cartQty: number;
  addQty: number;
}): boolean {
  if (productEsServicio(opts.product)) return false;
  const stock = stockFisicoProducto(opts.product);
  const needed = (Number(opts.cartQty) || 0) + (Number(opts.addQty) || 0);
  return needed > stock + 1e-9;
}
