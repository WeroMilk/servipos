import { describe, expect, test } from 'vitest';
import type { Product } from '@/types';
import {
  cartQtyForProduct,
  stockFisicoProducto,
  ventaExcedeExistencia,
} from '@/lib/posStockGuard';

const pieza: Product = {
  id: 'p1',
  sku: 'ABC',
  nombre: 'Filtro',
  precioVenta: 10,
  precioCompra: 5,
  existencia: 0,
  existenciaMinima: 1,
  categoria: 'A',
  impuesto: 16,
  unidadMedida: 'H87',
  activo: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  syncStatus: 'synced',
};

describe('stockFisicoProducto', () => {
  test('cero si no hay existencias', () => {
    expect(stockFisicoProducto(pieza)).toBe(0);
  });
  test('servicios no bloquean', () => {
    expect(stockFisicoProducto({ ...pieza, esServicio: true, existencia: 0 })).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});

describe('ventaExcedeExistencia', () => {
  test('bloquea agregar con stock 0', () => {
    expect(ventaExcedeExistencia({ product: pieza, cartQty: 0, addQty: 1 })).toBe(true);
  });
  test('permite si hay suficiente', () => {
    expect(
      ventaExcedeExistencia({ product: { ...pieza, existencia: 3 }, cartQty: 1, addQty: 1 })
    ).toBe(false);
  });
  test('bloquea si el carrito ya cubre el stock', () => {
    expect(
      ventaExcedeExistencia({ product: { ...pieza, existencia: 2 }, cartQty: 2, addQty: 1 })
    ).toBe(true);
  });
});

describe('cartQtyForProduct', () => {
  test('suma la línea', () => {
    expect(
      cartQtyForProduct([{ product: pieza, quantity: 2, discount: 0 }], 'p1')
    ).toBe(2);
  });
});
