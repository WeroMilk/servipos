import type { Client, Invoice } from '@/types';
import { getClientById } from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { getClientFirestore, getClientsCatalogSnapshot } from '@/lib/firestore/clientsFirestore';

export function pickNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const t = String(v ?? '').trim();
    if (t) return t;
  }
  return '';
}

/** Completa RFC/régimen/CP/uso CFDI del receptor con el catálogo vivo del cliente. */
export function mergeClienteDatosFiscales(
  embedded?: Client | null,
  live?: Client | null
): Client | undefined {
  if (!embedded && !live) return undefined;
  const e = embedded ?? undefined;
  const l = live ?? undefined;
  const base = { ...(l ?? {}), ...(e ?? {}) } as Client;
  const regimen = pickNonEmpty(e?.regimenFiscal, l?.regimenFiscal);
  const rfc = pickNonEmpty(e?.rfc, l?.rfc);
  const cp = pickNonEmpty(
    e?.codigoPostal,
    e?.direccion?.codigoPostal,
    l?.codigoPostal,
    l?.direccion?.codigoPostal
  );
  const uso = pickNonEmpty(e?.usoCfdi, l?.usoCfdi);
  const email = pickNonEmpty(e?.email, l?.email);
  const razon = pickNonEmpty(e?.razonSocial, l?.razonSocial);
  const nombre = pickNonEmpty(e?.nombre, l?.nombre) || base.nombre;
  return {
    ...base,
    id: pickNonEmpty(e?.id, l?.id) || base.id,
    rfc: rfc || undefined,
    nombre,
    razonSocial: razon || undefined,
    regimenFiscal: regimen || undefined,
    codigoPostal: cp || undefined,
    usoCfdi: uso || undefined,
    email: email || undefined,
    direccion: e?.direccion ?? l?.direccion ?? base.direccion,
    isMostrador: Boolean(e?.isMostrador ?? l?.isMostrador),
  };
}

export async function resolveLiveClient(clienteId?: string): Promise<Client | null> {
  const id = String(clienteId ?? '').trim();
  if (!id || id === 'mostrador') return null;
  const snap = getClientsCatalogSnapshot().find((c) => c.id === id) ?? null;
  if (pickNonEmpty(snap?.regimenFiscal)) return snap;
  const sid = getEffectiveSucursalId();
  if (sid) {
    const remote = await getClientFirestore(sid, id);
    if (remote) return remote;
  }
  return (await getClientById(id)) ?? snap;
}

export async function hydrateInvoiceClienteFiscal(invoice: Invoice): Promise<Invoice> {
  const live = await resolveLiveClient(invoice.clienteId || invoice.cliente?.id);
  const cliente = mergeClienteDatosFiscales(invoice.cliente, live);
  return {
    ...invoice,
    cliente,
    clienteId: invoice.clienteId || cliente?.id || invoice.clienteId,
  };
}
