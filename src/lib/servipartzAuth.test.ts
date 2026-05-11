import { describe, expect, it } from 'vitest';
import {
  getServipartzEmailDomain,
  normalizeServipartzEmail,
  buildLoginEmailCandidates,
} from '@/lib/servipartzAuth';

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

  it('buildLoginEmailCandidates pairs servipartz and serviparts', () => {
    expect(buildLoginEmailCandidates('zavala@servipartz.com')).toEqual([
      'zavala@servipartz.com',
      'zavala@serviparts.com',
    ]);
    expect(buildLoginEmailCandidates('gabriel@serviparts.com')).toEqual([
      'gabriel@serviparts.com',
      'gabriel@servipartz.com',
    ]);
    expect(buildLoginEmailCandidates('zavala')).toEqual(['zavala@servipartz.com', 'zavala@serviparts.com']);
  });

  it('buildLoginEmailCandidates can omit domain aliases', () => {
    expect(buildLoginEmailCandidates('zavala@servipartz.com', { includeDomainAliases: false })).toEqual([
      'zavala@servipartz.com',
    ]);
  });
});
