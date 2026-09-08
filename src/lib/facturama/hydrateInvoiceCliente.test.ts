import { describe, expect, test } from 'vitest';
import type { Client } from '@/types';
import { mergeClienteDatosFiscales, pickNonEmpty } from '@/lib/facturama/hydrateInvoiceCliente';

function client(partial: Partial<Client>): Client {
  return {
    id: 'c1',
    nombre: 'Cliente',
    isMostrador: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    ...partial,
  };
}

describe('mergeClienteDatosFiscales', () => {
  test('completa régimen y CP desde el catálogo si el snapshot de la venta no los trae', () => {
    const merged = mergeClienteDatosFiscales(
      client({ rfc: 'LEHJ841028K97', nombre: 'JESUS ALONSO LEON HERMOSILLO' }),
      client({
        rfc: 'LEHJ841028K97',
        regimenFiscal: '612',
        codigoPostal: '83118',
        usoCfdi: 'G03',
        razonSocial: 'JESUS ALONSO LEON HERMOSILLO',
      })
    );
    expect(merged?.regimenFiscal).toBe('612');
    expect(merged?.codigoPostal).toBe('83118');
    expect(merged?.rfc).toBe('LEHJ841028K97');
  });

  test('no pisa un régimen ya guardado en la factura', () => {
    const merged = mergeClienteDatosFiscales(
      client({ regimenFiscal: '601' }),
      client({ regimenFiscal: '612' })
    );
    expect(merged?.regimenFiscal).toBe('601');
  });
});

describe('pickNonEmpty', () => {
  test('salta vacíos', () => {
    expect(pickNonEmpty('', '  ', '612')).toBe('612');
  });
});
