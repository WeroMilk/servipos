import { describe, expect, test } from 'vitest';
import {
  checkoutFormaPagoPermiteCfdi,
  clientListoParaCfdi,
  satFormaPagoParaCfdi,
} from '@/lib/facturama/buildInvoiceFromSale';
import type { Client } from '@/types';

const fiscalClient: Client = {
  id: 'c1',
  nombre: 'ACME',
  razonSocial: 'ACME SA DE CV',
  rfc: 'XAXX010101000',
  regimenFiscal: '601',
  codigoPostal: '44100',
  isMostrador: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  syncStatus: 'synced',
};

describe('clientListoParaCfdi', () => {
  test('acepta cliente con RFC régimen y CP', () => {
    expect(clientListoParaCfdi(fiscalClient).ok).toBe(true);
  });
  test('rechaza mostrador', () => {
    expect(clientListoParaCfdi({ ...fiscalClient, id: 'mostrador', isMostrador: true }).ok).toBe(
      false
    );
  });
});

describe('satFormaPagoParaCfdi', () => {
  test('PPD y PPC usan 99', () => {
    expect(satFormaPagoParaCfdi('01', 'PPD')).toBe('99');
    expect(satFormaPagoParaCfdi('PPC', 'PPD')).toBe('99');
  });
  test('PUE conserva efectivo', () => {
    expect(satFormaPagoParaCfdi('01', 'PUE')).toBe('01');
  });
});

describe('checkoutFormaPagoPermiteCfdi', () => {
  test('bloquea internos', () => {
    expect(checkoutFormaPagoPermiteCfdi('TTS')).toBe(false);
    expect(checkoutFormaPagoPermiteCfdi('01')).toBe(true);
  });
});
