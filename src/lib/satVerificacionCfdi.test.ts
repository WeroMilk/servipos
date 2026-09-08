import { describe, expect, test } from 'vitest';
import type { Invoice } from '@/types';
import { buildInvoiceCfdiQrUrl, CFDI_MUESTRA_UUID } from '@/lib/satVerificacionCfdi';

function invoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    folio: '2',
    serie: 'A',
    clienteId: 'c1',
    cliente: {
      id: 'c1',
      nombre: 'Cliente',
      rfc: 'MOGH900906912',
    } as Invoice['cliente'],
    emisor: { rfc: 'ZADJ970326LK8' } as Invoice['emisor'],
    productos: [],
    subtotal: 1517.24,
    descuento: 0,
    impuestosTrasladados: 242.76,
    impuestosRetenidos: 0,
    total: 1760,
    formaPago: '01',
    metodoPago: 'PUE',
    lugarExpedicion: '83180',
    fechaEmision: new Date('2026-09-08T12:00:00Z'),
    estado: 'timbrada',
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    ...partial,
  };
}

describe('buildInvoiceCfdiQrUrl', () => {
  test('genera QR SAT con UUID aunque falte el sello digital', () => {
    const url = buildInvoiceCfdiQrUrl(
      invoice({
        uuid: '6D8A445A-F103-42C6-AB1F-9D8D30D4892C',
        selloDigital: undefined,
      })
    );
    expect(url).toContain('verificacfdi.facturaelectronica.sat.gob.mx');
    expect(url).toContain('6D8A445A-F103-42C6-AB1F-9D8D30D4892C');
    expect(url).toContain('ZADJ970326LK8');
    expect(url).toContain('MOGH900906912');
  });

  test('usa RFC emisor de respaldo si la factura no lo trae', () => {
    const url = buildInvoiceCfdiQrUrl(
      invoice({
        uuid: '6D8A445A-F103-42C6-AB1F-9D8D30D4892C',
        emisor: { rfc: '' } as Invoice['emisor'],
      }),
      'ZADJ970326LK8'
    );
    expect(url).toContain('re=ZADJ970326LK8');
  });

  test('sin UUID ni modo prueba no genera QR', () => {
    expect(buildInvoiceCfdiQrUrl(invoice({ uuid: undefined, esPrueba: false }))).toBeNull();
  });

  test('modo prueba usa UUID de muestra', () => {
    const url = buildInvoiceCfdiQrUrl(invoice({ uuid: undefined, esPrueba: true }));
    expect(url).toContain(CFDI_MUESTRA_UUID);
  });
});
