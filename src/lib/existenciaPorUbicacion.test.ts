import { describe, expect, it } from 'vitest';
import {
  entriesExistenciaPorUbicacion,
  mergeExistenciaEnUbicacion,
  normalizeUbicacionKey,
  qtyEnUbicacion,
  sumExistenciaPorUbicacion,
} from '@/lib/existenciaPorUbicacion';

describe('existenciaPorUbicacion', () => {
  it('normaliza casing de ubicaciones conocidas', () => {
    expect(normalizeUbicacionKey('mostrador')).toBe('Mostrador');
    expect(normalizeUbicacionKey('BODEGA')).toBe('Bodega');
    expect(normalizeUbicacionKey('b')).toBe('B');
  });

  it('acumula por ubicación y suma el total', () => {
    let map = mergeExistenciaEnUbicacion(undefined, 'Mostrador', 15);
    map = mergeExistenciaEnUbicacion(map, 'B', 10);
    map = mergeExistenciaEnUbicacion(map, 'Bodega', 500);
    expect(qtyEnUbicacion(map, 'Mostrador')).toBe(15);
    expect(qtyEnUbicacion(map, 'B')).toBe(10);
    expect(qtyEnUbicacion(map, 'Bodega')).toBe(500);
    expect(sumExistenciaPorUbicacion(map)).toBe(525);
    const entries = entriesExistenciaPorUbicacion(map);
    expect(entries.map((e) => e.label)).toEqual(['mostrador', 'bodega', 'mueble B']);
  });

  it('reemplaza cantidad en la misma ubicación', () => {
    let map = mergeExistenciaEnUbicacion(undefined, 'Mostrador', 15);
    map = mergeExistenciaEnUbicacion(map, 'Mostrador', 12);
    expect(sumExistenciaPorUbicacion(map)).toBe(12);
  });
});
