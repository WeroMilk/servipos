import type { Client } from '@/types';

/** Id interno del cliente genérico (ventas sin registro en catálogo). */
export const POS_GENERIC_CLIENT_ID = 'mostrador';

/** Etiqueta mostrada en POS, tickets y cobro sin cliente registrado. */
export const POS_GENERIC_CLIENT_LABEL = 'Público General';

const LEGACY_GENERIC_LABELS = new Set(['mostrador', 'público general', 'publico general']);

export function isPosGenericClient(
  client: Pick<Client, 'id' | 'isMostrador'> | null | undefined
): boolean {
  return !client || client.id === POS_GENERIC_CLIENT_ID || client.isMostrador === true;
}

export function isPosGenericClienteNombre(nombre: string | undefined | null): boolean {
  const n = (nombre ?? '').trim().toLowerCase();
  if (!n) return true;
  return LEGACY_GENERIC_LABELS.has(n);
}

/** Nombre a mostrar en la UI del POS para el cliente del ticket. */
export function posClienteDisplayNombre(
  client: Pick<Client, 'nombre' | 'id' | 'isMostrador'> | null | undefined
): string {
  if (isPosGenericClient(client)) return POS_GENERIC_CLIENT_LABEL;
  const n = client!.nombre?.trim();
  return n || POS_GENERIC_CLIENT_LABEL;
}
