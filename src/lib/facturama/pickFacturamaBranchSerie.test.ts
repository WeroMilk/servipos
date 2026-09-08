import { describe, expect, test } from 'vitest';
import {
  pickFacturamaBranchByZip,
  pickFacturamaSerieName,
  normalizeFacturamaSerieName,
} from '@/lib/facturama/pickFacturamaBranchSerie';

describe('pickFacturamaBranchByZip', () => {
  const branches = [
    { Id: 'other', Address: { ZipCode: '44100' } },
    { Id: 'olivares', Address: { ZipCode: '83180' }, IsDefault: true },
  ];

  test('elige la sucursal del CP de expedición', () => {
    expect(pickFacturamaBranchByZip(branches, '83180')?.Id).toBe('olivares');
  });

  test('si el CP no coincide usa la sucursal default', () => {
    expect(pickFacturamaBranchByZip(branches, '99999')?.Id).toBe('olivares');
  });
});

describe('pickFacturamaSerieName', () => {
  test('prefiere la serie pedida si existe en la sucursal', () => {
    expect(pickFacturamaSerieName([{ Name: 'F' }, { Name: 'A' }], 'A')).toBe('A');
  });

  test('si la pedida no existe usa A o la primera', () => {
    expect(pickFacturamaSerieName([{ Name: 'F' }], 'A')).toBe('F');
  });

  test('normaliza nombres inválidos', () => {
    expect(normalizeFacturamaSerieName('')).toBe('');
    expect(normalizeFacturamaSerieName('A-1')).toBe('');
    expect(normalizeFacturamaSerieName('A')).toBe('A');
  });
});
