import type { Client, Quotation } from '@/types';

export function clientFromQuotationForPos(q: Quotation): Client | null {
  if (q.clienteId === 'mostrador') return null;
  const c = q.cliente;
  if (c?.nombre?.trim()) {
    return {
      id: c.id || q.clienteId,
      nombre: c.nombre,
      rfc: c.rfc,
      razonSocial: c.razonSocial,
      isMostrador: c.isMostrador === true,
      listaPreciosId: c.listaPreciosId,
      createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(),
      updatedAt: c.updatedAt instanceof Date ? c.updatedAt : new Date(),
      syncStatus: 'synced',
    };
  }
  return null;
}
