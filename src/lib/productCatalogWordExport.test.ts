import { describe, expect, test } from 'vitest';
import { Packer } from 'docx';
import type { Product } from '@/types';
import {
  buildProductCatalogDocument,
  catalogProductsForWord,
  CATALOG_WORD_LAYOUT,
} from '@/lib/productCatalogWordExport';

function product(partial: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'SKU-100',
    nombre: 'Filtro',
    precioVenta: 100,
    precioCompra: 50,
    impuesto: 16,
    existencia: 1,
    existenciaMinima: 0,
    unidadMedida: 'H87',
    activo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    preciosPorListaCliente: {
      regular: 116,
      tecnico: 110,
      mayoreo_menos: 105,
      mayoreo_mas: 100,
      cananea: 95,
    },
    preciosListaIncluyenIva: true,
    ...partial,
  };
}

describe('catalogProductsForWord', () => {
  test('omite inactivos y servicios; ordena por SKU', () => {
    const rows = catalogProductsForWord([
      product({ id: 'b', sku: 'B-2', nombre: 'Beta' }),
      product({ id: 'a', sku: 'A-1', nombre: 'Alfa' }),
      product({ id: 'x', sku: 'X', nombre: 'Off', activo: false }),
      product({ id: 's', sku: 'SRV', nombre: 'Instalación', esServicio: true }),
    ]);
    expect(rows.map((p) => p.sku)).toEqual(['A-1', 'B-2']);
  });
});

describe('CATALOG_WORD_LAYOUT', () => {
  test('A4 horizontal y 9 columnas que cubren el ancho útil', () => {
    expect(CATALOG_WORD_LAYOUT.pageW).toBeGreaterThan(CATALOG_WORD_LAYOUT.pageH);
    expect(CATALOG_WORD_LAYOUT.colWidths).toHaveLength(9);
    const sum = CATALOG_WORD_LAYOUT.colWidths.reduce((a, b) => a + b, 0);
    expect(sum).toBe(CATALOG_WORD_LAYOUT.usable);
    expect(CATALOG_WORD_LAYOUT.colWidths[8]).toBeGreaterThan(1500);
  });
});

describe('buildProductCatalogDocument', () => {
  test('genera un .docx (ZIP) válido', async () => {
    const doc = buildProductCatalogDocument({
      products: [product()],
      sucursalNombre: 'Olivares',
      generatedAt: new Date('2026-09-10T12:00:00'),
    });
    const buf = await Packer.toBuffer(doc);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
