import { describe, expect, it } from 'vitest';
import {
  applyPromotionsToCartItems,
  effectiveDiscountPercentForQty,
  promoLabel,
} from '@/lib/promotions/applyPromotions';
import type { CartItem, Product, Promotion } from '@/types';

function makeProduct(partial: Partial<Product> = {}): Product {
  const now = new Date();
  return {
    id: 'p1',
    sku: 'SKU1',
    nombre: 'Producto 1',
    descripcion: '',
    precioVenta: 400,
    precioCompra: 100,
    impuesto: 16,
    existencia: 10,
    existenciaMinima: 0,
    categoria: '',
    unidadMedida: 'H87',
    claveProdServ: '01010101',
    activo: true,
    syncStatus: 'synced',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function makePromo(partial: Partial<Promotion> = {}): Promotion {
  const now = new Date();
  return {
    id: 'promo1',
    nombre: 'Promo fija',
    kind: 'fixed_price',
    fixedPrice: 250,
    fechaInicio: '2020-01-01',
    fechaFin: '2099-12-31',
    productIds: ['p1'],
    activa: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('fixed_price promotions', () => {
  it('labels fixed price with money', () => {
    expect(promoLabel(makePromo({ fixedPrice: 250 }))).toMatch(/250/);
  });

  it('does not use percent discount for fixed_price', () => {
    expect(effectiveDiscountPercentForQty(makePromo(), 3)).toBe(0);
  });

  it('applies fixed price as unit override on cart lines', () => {
    const product = makeProduct();
    const items: CartItem[] = [{ product, quantity: 2, discount: 0 }];
    const next = applyPromotionsToCartItems(items, [makePromo({ fixedPrice: 250 })]);
    expect(next[0]?.precioUnitarioOverride).toBe(250);
    expect(next[0]?.discount).toBe(0);
    expect(next[0]?.promoId).toBe('promo1');
  });

  it('clears override when promo is removed', () => {
    const product = makeProduct();
    const items: CartItem[] = [
      {
        product,
        quantity: 1,
        discount: 0,
        promoId: 'promo1',
        promoLabel: '$250.00',
        precioUnitarioOverride: 250,
      },
    ];
    const next = applyPromotionsToCartItems(items, []);
    expect(next[0]?.promoId).toBeUndefined();
    expect(next[0]?.precioUnitarioOverride).toBeUndefined();
  });
});
