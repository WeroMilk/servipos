import { describe, expect, it } from 'vitest';
import { getEffectivePermissions, userCanSeeInventoryMissions, userHasPermission } from '@/lib/userPermissions';
import type { User } from '@/types';

function makeUser(partial: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: 'u1',
    username: 'cashier1',
    name: 'Cashier 1',
    email: 'cashier1@servipartz.com',
    role: 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('userPermissions', () => {
  it('grants admin full permission template', () => {
    const admin = makeUser({ role: 'admin' });
    expect(userHasPermission(admin, 'usuarios:gestionar')).toBe(true);
    expect(userHasPermission(admin, 'sucursales:gestionar')).toBe(true);
  });

  it('uses custom permissions when enabled', () => {
    const user = makeUser({
      role: 'admin',
      useCustomPermissions: true,
      customPermissions: ['ventas:ver'],
    });
    expect(getEffectivePermissions(user)).toEqual(['ventas:ver']);
    expect(userHasPermission(user, 'usuarios:gestionar')).toBe(false);
  });

  it('shows inventory missions for active cashier with mission permission', () => {
    const cashier = makeUser({ role: 'cashier' });
    expect(userCanSeeInventoryMissions(cashier)).toBe(true);
  });
});
