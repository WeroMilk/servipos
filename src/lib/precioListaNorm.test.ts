import { describe, expect, it } from 'vitest';
import { inferPrecioVentaSinIvaFromListas, resolvePrecioVentaSinIvaForDoc } from './precioListaNorm';

describe('inferPrecioVentaSinIvaFromListas', () => {
  it('toma el mayor sin IVA cuando regular está desactualizado pero otra lista trae el precio nuevo', () => {
    const map = {
      regular: 950,
      tecnico: 1050,
    };
    const sin = inferPrecioVentaSinIvaFromListas(map, true, 16);
    expect(sin).toBeCloseTo(1050 / 1.16, 2);
  });
});

describe('resolvePrecioVentaSinIvaForDoc', () => {
  it('eleva precioVenta del documento al tope inferido desde listas', () => {
    const listaImportesConIva = true;
    const impuesto = 16;
    const pv950sin = Math.round((950 / 1.16) * 100) / 100;

    const resolved = resolvePrecioVentaSinIvaForDoc({
      rawPv: pv950sin,
      preciosPorListaCliente: { regular: 950, tecnico: 1050 },
      preciosListaIncluyenIva: listaImportesConIva,
      impuesto,
    });

    expect(resolved).toBeCloseTo(1050 / 1.16, 2);
  });
});
