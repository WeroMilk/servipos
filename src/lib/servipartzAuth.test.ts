import { describe, expect, it } from 'vitest';
import { getServipartzEmailDomain, normalizeServipartzEmail } from '@/lib/servipartzAuth';

describe('servipartzAuth', () => {
  it('uses default domain when env is missing', () => {
    expect(getServipartzEmailDomain()).toBe('servipartz.com');
  });

  it('normalizes short username into corporate email', () => {
    expect(normalizeServipartzEmail('  ZaVaLa ')).toBe('zavala@servipartz.com');
  });

  it('keeps full emails normalized and lowercased', () => {
    expect(normalizeServipartzEmail(' USER@Example.COM ')).toBe('user@example.com');
  });
});
