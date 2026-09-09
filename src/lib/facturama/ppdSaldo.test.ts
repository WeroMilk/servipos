import { describe, expect, test } from 'vitest';
import type { Invoice } from '@/types';
import { invoiceAceptaComplementoPago, saldoInsolutoFacturaPpd } from '@/lib/facturama/ppdSaldo';

function invoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    folio: '1',
    serie: 'A',
    clienteId: 'c1',
    productos: [],
    subtotal: 100,
    descuento: 0,
    impuestosTrasladados: 16,
    impuestosRetenidos: 0,
    total: 116,
    formaPago: '99',
    metodoPago: 'PPD',
    lugarExpedicion: '83180',
    emisor: { rfc: 'ZADJ970326LK8', lugarExpedicion: '83180' } as Invoice['emisor'],
    fechaEmision: new Date(),
    estado: 'timbrada',
    uuid: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    ...partial,
  };
}

describe('invoiceAceptaComplementoPago', () => {
  test('acepta PPD u Otros 99 con saldo', () => {
    expect(invoiceAceptaComplementoPago(invoice())).toBe(true);
    expect(
      invoiceAceptaComplementoPago(invoice({ metodoPago: 'PUE', formaPago: '99' }))
    ).toBe(true);
  });
  test('rechaza PUE efectivo o sin UUID', () => {
    expect(
      invoiceAceptaComplementoPago(invoice({ metodoPago: 'PUE', formaPago: '01' }))
    ).toBe(false);
    expect(invoiceAceptaComplementoPago(invoice({ uuid: undefined }))).toBe(false);
  });
  test('rechaza si ya se cubrió el saldo', () => {
    expect(
      invoiceAceptaComplementoPago(
        invoice({
          complementosPago: [
            {
              id: 'p1',
              facturamaId: 'f',
              uuid: '22222222-2222-2222-2222-222222222222',
              fechaPago: '2026-09-09',
              formaPago: '03',
              monto: 116,
              saldoAnterior: 116,
              numeroParcialidad: 1,
              estado: 'timbrada',
            },
          ],
        })
      )
    ).toBe(false);
  });
});

describe('saldoInsolutoFacturaPpd', () => {
  test('resta complementos timbrados', () => {
    expect(
      saldoInsolutoFacturaPpd(
        invoice({
          complementosPago: [
            {
              id: 'p1',
              facturamaId: 'f',
              uuid: '22222222-2222-2222-2222-222222222222',
              fechaPago: '2026-09-09',
              formaPago: '03',
              monto: 50,
              saldoAnterior: 116,
              numeroParcialidad: 1,
              estado: 'timbrada',
            },
          ],
        })
      )
    ).toBe(66);
  });
});
