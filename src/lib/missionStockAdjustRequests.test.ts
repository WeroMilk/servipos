import { describe, expect, it } from 'vitest';
import {
  parseMissionStockAdjustRequestsDoc,
  userCanApproveMissionStockAdjust,
  userNeedsMissionStockAdjustApproval,
} from '@/lib/missionStockAdjustRequests';
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

describe('missionStockAdjustRequests', () => {
  it('allows Gabriel, Zavala and admin/gerente to approve', () => {
    expect(userCanApproveMissionStockAdjust(makeUser({ username: 'gabriel', role: 'cashier' }))).toBe(
      true
    );
    expect(userCanApproveMissionStockAdjust(makeUser({ username: 'zavala', role: 'admin' }))).toBe(
      true
    );
    expect(userCanApproveMissionStockAdjust(makeUser({ role: 'gerente' }))).toBe(true);
    expect(userCanApproveMissionStockAdjust(makeUser({ username: 'alfonso', role: 'cashier' }))).toBe(
      false
    );
    expect(userNeedsMissionStockAdjustApproval(makeUser({ username: 'alfonso' }))).toBe(true);
  });

  it('parses pending requests doc', () => {
    const doc = parseMissionStockAdjustRequestsDoc({
      items: [
        {
          id: 'r1',
          productId: 'p1',
          productNombre: 'Manguera',
          productSku: '836',
          cantidadAnterior: 565,
          cantidadNueva: 560,
          comentario: 'faltante',
          origen: 'mision_lista',
          solicitadoPorId: 'u-alfonso',
          solicitadoPorNombre: 'Alfonso',
          createdAt: '2026-07-25T12:00:00.000Z',
        },
        { id: '', productId: 'bad' },
      ],
      updatedAt: '2026-07-25T12:00:00.000Z',
    });
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]?.cantidadNueva).toBe(560);
  });
});
