import { describe, expect, test } from 'vitest';
import type { Invoice } from '@/types';
import {
  FACTURAS_SERVIPARTZ_ROOT,
  invoiceCfdiFileBaseName,
  invoiceClientFolderName,
  invoiceDateFolderName,
  invoiceServipartzRelativeDir,
  sanitizeFolderName,
} from '@/lib/invoiceFolderPaths';

function invoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    folio: '12',
    serie: 'A',
    clienteId: 'c1',
    cliente: {
      id: 'c1',
      nombre: 'Cliente / Prueba',
      razonSocial: 'ACME SA DE CV',
    } as Invoice['cliente'],
    emisor: { rfc: 'EKU9003173C9', lugarExpedicion: '44100' } as Invoice['emisor'],
    productos: [],
    subtotal: 0,
    descuento: 0,
    impuestosTrasladados: 0,
    impuestosRetenidos: 0,
    total: 0,
    formaPago: '03',
    metodoPago: 'PUE',
    lugarExpedicion: '44100',
    fechaEmision: new Date(2026, 8, 9, 12, 0, 0),
    estado: 'timbrada',
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    ...partial,
  };
}

describe('invoiceFolderPaths', () => {
  test('sanitiza caracteres inválidos de Windows', () => {
    expect(sanitizeFolderName('A:B*C?')).toBe('A B C');
    expect(sanitizeFolderName('  ..  ')).toBe('Cliente');
  });

  test('carpeta de cliente usa razón social', () => {
    expect(invoiceClientFolderName(invoice())).toBe('ACME SA DE CV');
  });

  test('fecha de carpeta YYYY-MM-DD y archivos con serie-folio', () => {
    const inv = invoice({ fechaTimbrado: new Date(2026, 8, 9, 18, 0, 0) });
    expect(invoiceDateFolderName(inv)).toBe('2026-09-09');
    expect(invoiceCfdiFileBaseName(inv)).toBe('CFDI_A_12');
    expect(invoiceServipartzRelativeDir(inv)).toBe(
      `${FACTURAS_SERVIPARTZ_ROOT}/ACME SA DE CV/2026-09-09`
    );
  });
});
