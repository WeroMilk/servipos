import type { Client } from '@/types';

/** Misma lógica que `searchClients` en Dexie, sobre lista en memoria (cloud). */
export function filterClientsByQuery(clients: readonly Client[], query: string): Client[] {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return [];
  return clients.filter((c) => {
    if (c.isMostrador) return false;
    return (
      c.nombre.toLowerCase().includes(lowerQuery) ||
      (c.rfc !== undefined && c.rfc.toLowerCase().includes(lowerQuery))
    );
  });
}
