import { describe, expect, it } from 'vitest';
import { clientReachedCreditLimit } from '@/lib/clientCreditLimit';

describe('clientReachedCreditLimit', () => {
  it('returns false when limit is missing', () => {
    expect(clientReachedCreditLimit({ isMostrador: false, saldoAdeudado: 5000 })).toBe(false);
    expect(
      clientReachedCreditLimit({ isMostrador: false, saldoAdeudado: 5000, limiteCredito: null })
    ).toBe(false);
  });

  it('returns false for mostrador', () => {
    expect(
      clientReachedCreditLimit({
        isMostrador: true,
        saldoAdeudado: 9000,
        limiteCredito: 1000,
      })
    ).toBe(false);
  });

  it('returns true when adeudo reaches or exceeds limit', () => {
    expect(
      clientReachedCreditLimit({
        isMostrador: false,
        saldoAdeudado: 4500,
        limiteCredito: 4500,
      })
    ).toBe(true);
    expect(
      clientReachedCreditLimit({
        isMostrador: false,
        saldoAdeudado: 4501,
        limiteCredito: 4500,
      })
    ).toBe(true);
  });

  it('returns false when adeudo is below limit', () => {
    expect(
      clientReachedCreditLimit({
        isMostrador: false,
        saldoAdeudado: 100,
        limiteCredito: 4500,
      })
    ).toBe(false);
  });
});
