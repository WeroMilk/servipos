import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { buildProductSearchIndex, searchProductIndex } from './productSearchIndex';

function product(partial: Partial<Product>): Product {
  return {
    id: partial.id ?? '1',
    sku: partial.sku ?? '1',
    nombre: partial.nombre ?? 'Producto',
    precioVenta: 1,
    impuesto: 16,
    existencia: 1,
    existenciaMinima: 0,
    unidadMedida: 'H87',
    activo: true,
    ...partial,
    createdAt: partial.createdAt ?? new Date(0),
    updatedAt: partial.updatedAt ?? new Date(0),
    syncStatus: partial.syncStatus ?? 'synced',
  };
}

describe('searchProductIndex', () => {
  it('encuentra por nombre, SKU o descripción', () => {
    const index = buildProductSearchIndex([
      product({ id: 'a', sku: '811', nombre: 'FILTRO', descripcion: 'compatible con bomba azul' }),
      product({ id: 'b', sku: '900', nombre: 'MANGUERA', descripcion: 'roja' }),
    ]);

    expect(searchProductIndex(index, 'filtro').map((p) => p.id)).toEqual(['a']);
    expect(searchProductIndex(index, '811').map((p) => p.id)).toEqual(['a']);
    expect(searchProductIndex(index, 'bomba azul').map((p) => p.id)).toEqual(['a']);
  });
});
