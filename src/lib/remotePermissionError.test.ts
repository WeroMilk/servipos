import { describe, expect, it } from 'vitest';
import { isRemotePermissionDenied } from '@/lib/remotePermissionError';

describe('isRemotePermissionDenied', () => {
  it('detects common permission-denied text patterns', () => {
    expect(isRemotePermissionDenied(new Error('RLS policy violation'))).toBe(true);
    expect(isRemotePermissionDenied(new Error('permission denied for table'))).toBe(true);
  });

  it('detects known error codes', () => {
    expect(isRemotePermissionDenied({ code: '42501' })).toBe(true);
    expect(isRemotePermissionDenied({ code: 'permission-denied' })).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isRemotePermissionDenied(new Error('network timeout'))).toBe(false);
  });
});
