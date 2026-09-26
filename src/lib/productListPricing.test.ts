import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { getListaPrecioClientePct } from '@/stores/clientPriceListStore';
import { getProductUnitConIvaForClienteList, getProductUnitSinIvaForClienteList } from './productListPricing';

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function product(partial: Partial<Product>): Product {
  return {
    id: '811',
    sku: '811',
    nombre: 'SKU 811',
    precioVenta: roundMoney2(2 / 1.16),
    impuesto: 16,
    existencia: 1,
    existenciaMinima: 0,
    unidadMedida: 'H87',
    activo: true,
    preciosListaIncluyenIva: true,
    ...partial,
    createdAt: partial.createdAt ?? new Date(0),
    updatedAt: partial.updatedAt ?? new Date(0),
    syncStatus: partial.syncStatus ?? 'synced',
  };
}

describe('getProductUnitSinIvaForClienteList', () => {
  it('respeta el importe fijo aunque quede a un centavo del Regular', () => {
    const p = product({
      preciosPorListaCliente: {
        regular: 2,
        tecnico: 2.01,
        mayoreo_menos: 2.01,
        mayoreo_mas: 2.01,
        cananea: 0.49,
      },
    });

    expect(roundMoney2(getProductUnitConIvaForClienteList(p, 'regular'))).toBe(2);
    expect(roundMoney2(getProductUnitConIvaForClienteList(p, 'tecnico'))).toBe(2.01);
    expect(roundMoney2(getProductUnitConIvaForClienteList(p, 'mayoreo_menos'))).toBe(2.01);
    expect(roundMoney2(getProductUnitConIvaForClienteList(p, 'mayoreo_mas'))).toBe(2.01);
    expect(roundMoney2(getProductUnitConIvaForClienteList(p, 'cananea'))).toBe(0.49);
  });

  it('aplica el % de configuración cuando la lista no tiene importe', () => {
    const p = product({
      preciosPorListaCliente: { regular: 2 },
    });
    const pct = getListaPrecioClientePct('tecnico');
    const expected = getProductUnitSinIvaForClienteList(p, 'regular') * (1 - pct / 100);
    expect(getProductUnitSinIvaForClienteList(p, 'tecnico')).toBeCloseTo(expected, 6);
  });
});
