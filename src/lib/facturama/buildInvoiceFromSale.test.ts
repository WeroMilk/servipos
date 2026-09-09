import { describe, expect, test } from 'vitest';
import {
  checkoutFormaPagoPermiteCfdi,
  clientListoParaCfdi,
  esFormaPagoACuenta,
  metodoPagoParaCfdi,
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
  test('PPD, PPC y Otros (99) usan 99', () => {
    expect(satFormaPagoParaCfdi('01', 'PPD')).toBe('99');
    expect(satFormaPagoParaCfdi('PPC', 'PPD')).toBe('99');
    expect(satFormaPagoParaCfdi('99', 'PUE')).toBe('99');
  });
  test('PUE conserva efectivo', () => {
    expect(satFormaPagoParaCfdi('01', 'PUE')).toBe('01');
  });
});

describe('esFormaPagoACuenta', () => {
  test('PPC y 99', () => {
    expect(esFormaPagoACuenta('PPC')).toBe(true);
    expect(esFormaPagoACuenta('99')).toBe(true);
    expect(esFormaPagoACuenta('01')).toBe(false);
  });
});

describe('metodoPagoParaCfdi', () => {
  test('Otros fuerza PPD', () => {
    expect(metodoPagoParaCfdi('99', 'PUE')).toBe('PPD');
    expect(metodoPagoParaCfdi('01', 'PUE')).toBe('PUE');
  });
});

describe('checkoutFormaPagoPermiteCfdi', () => {
  test('bloquea internos y permite Otros', () => {
    expect(checkoutFormaPagoPermiteCfdi('TTS')).toBe(false);
    expect(checkoutFormaPagoPermiteCfdi('01')).toBe(true);
    expect(checkoutFormaPagoPermiteCfdi('99')).toBe(true);
  });
});
