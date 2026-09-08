import { describe } from 'vitest';
import { expect, test } from 'vitest';
import type { Invoice, InvoiceItem } from '@/types';
import { mapInvoiceToFacturama } from '@/lib/facturama/mapInvoiceToFacturama';
import { mapPaymentComplementToFacturama } from '@/lib/facturama/mapPaymentComplementToFacturama';
import { ivaTasaFromPercentOrRate, mapInvoiceTaxesToFacturama } from '@/lib/facturama/taxes';
import { assertPagoCfdi, isValidRfcSat } from '@/lib/facturama/validateCfdi';

function item(partial: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 'i1',
    productId: 'p1',
    claveProdServ: '52141500',
    claveUnidad: 'H87',
    cantidad: 2,
    descripcion: 'Filtro de aceite',
    precioUnitario: 100,
    descuento: 10,
    impuestosTrasladados: [
      {
        tipo: 'Traslado',
        impuesto: '002',
        tipoFactor: 'Tasa',
        tasaOCuota: 0.16,
        base: 190,
        importe: 30.4,
      },
    ],
    impuestosRetenidos: [],
    subtotal: 200,
    total: 220.4,
    ...partial,
  };
}

function invoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    folio: '12',
    serie: 'A',
    clienteId: 'c1',
    cliente: {
      id: 'c1',
      nombre: 'Cliente Prueba',
      razonSocial: 'ACME SA DE CV',
      rfc: 'XAXX010101000',
      regimenFiscal: '601',
      usoCfdi: 'G03',
      codigoPostal: '44100',
      email: 'cliente@example.com',
    } as Invoice['cliente'],
    emisor: { rfc: 'EKU9003173C9', lugarExpedicion: '44100' } as Invoice['emisor'],
    productos: [item()],
    subtotal: 200,
    descuento: 10,
    impuestosTrasladados: 30.4,
    impuestosRetenidos: 0,
    total: 220.4,
    formaPago: '03',
    metodoPago: 'PUE',
    lugarExpedicion: '44100',
    fechaEmision: new Date('2026-09-07T12:00:00Z'),
    estado: 'pendiente',
    createdAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'synced',
    ...partial,
  };
}

describe('ivaTasaFromPercentOrRate', () => {
  test('acepta porcentaje 16 y tasa 0.16', () => {
    expect(ivaTasaFromPercentOrRate(16)).toBe(0.16);
    expect(ivaTasaFromPercentOrRate(0.16)).toBe(0.16);
    expect(ivaTasaFromPercentOrRate(0)).toBe(0);
  });
});

describe('mapInvoiceTaxesToFacturama', () => {
  test('usa booleanos y nombre IVA', () => {
    const taxes = mapInvoiceTaxesToFacturama(item());
    expect(taxes).toHaveLength(1);
    expect(taxes[0]?.Name).toBe('IVA');
    expect(taxes[0]?.IsRetention).toBe(false);
    expect(taxes[0]?.IsFederalTax).toBe(true);
    expect(taxes[0]?.Rate).toBe('0.16');
  });
});

describe('mapInvoiceToFacturama', () => {
  test('payload ingreso con NameId numérico, unidad Pieza y email', () => {
    const payload = mapInvoiceToFacturama(invoice());
    expect(payload.NameId).toBe(1);
    expect(payload.CfdiType).toBe('I');
    const items = payload.Items as Array<Record<string, unknown>>;
    expect(items[0]?.Unit).toBe('Pieza');
    expect(items[0]?.Discount).toBe('10.00');
    const recv = payload.Receiver as Record<string, unknown>;
    expect(recv.Email).toBe('cliente@example.com');
    const tax0 = (items[0]?.Taxes as Array<Record<string, unknown>>)[0];
    expect(tax0?.IsRetention).toBe(false);
  });

  test('rechaza PUE con forma 99', () => {
    expect(() => mapInvoiceToFacturama(invoice({ metodoPago: 'PUE', formaPago: '99' }))).toThrow(
      /PUE/
    );
  });
});

describe('mapPaymentComplementToFacturama', () => {
  test('NameId 14 y montos a 2 decimales', () => {
    const payload = mapPaymentComplementToFacturama({
      invoice: invoice({
        uuid: '11111111-1111-1111-1111-111111111111',
        metodoPago: 'PPD',
        formaPago: '99',
        estado: 'timbrada',
      }),
      paymentDate: new Date('2026-09-07T15:00:00Z'),
      paymentForm: '03',
      amountPaid: 50,
      previousBalance: 220.4,
      partialityNumber: 1,
    });
    expect(payload.NameId).toBe(14);
    expect(payload.CfdiType).toBe('P');
    const pay = (payload.Complemento as { Payments: Array<{ Amount: string }> }).Payments[0];
    expect(pay?.Amount).toBe('50.00');
  });
});

describe('validateCfdi', () => {
  test('RFC genérico y PPD', () => {
    expect(isValidRfcSat('XAXX010101000')).toBe(true);
    expect(() => assertPagoCfdi('PPD', '03')).toThrow(/99/);
    expect(() => assertPagoCfdi('PPD', '99')).not.toThrow();
  });
});
