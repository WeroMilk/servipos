import { describe, expect, it } from 'vitest';
import { docToAppEvent } from '@/lib/firestore/appEventsFirestore';

describe('docToAppEvent', () => {
  it('maps and sanitizes unknown payload values', () => {
    const row = docToAppEvent('evt1', {
      kind: 'unexpected',
      source: 'auth',
      title: 'Evento',
      createdAt: '2026-04-09T10:00:00.000Z',
      actorName: 'Admin',
      actorEmail: 'admin@servipartz.com',
    });

    expect(row.id).toBe('evt1');
    expect(row.kind).toBe('info');
    expect(row.source).toBe('auth');
    expect(row.title).toBe('Evento');
  });
});
