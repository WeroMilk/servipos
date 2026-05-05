import type { Client, ClientAbonoHistorialEntry } from '@/types';
import { normalizeClientPriceListId } from '@/lib/clientPriceLists';
import { getSupabase } from '@/lib/supabaseClient';

function firestoreTimestampToDate(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

function parseAbonosHistorialDoc(raw: unknown): ClientAbonoHistorialEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ClientAbonoHistorialEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.at == null) continue;
    const at = firestoreTimestampToDate(o.at);
    const monto = Number(o.monto);
    if (!Number.isFinite(monto) || monto < 0) continue;
    const saldoAnt = Number(o.saldoAnterior);
    const saldoNvo = Number(o.saldoNuevo);
    const usuarioNombreRaw = o.usuarioNombre != null ? String(o.usuarioNombre).trim() : '';
    out.push({
      at,
      monto: Math.max(0, Math.round(monto * 100) / 100),
      saldoAnterior:
        Number.isFinite(saldoAnt) ? Math.max(0, Math.round(saldoAnt * 100) / 100) : 0,
      saldoNuevo: Number.isFinite(saldoNvo) ? Math.max(0, Math.round(saldoNvo * 100) / 100) : 0,
      usuarioNombre: usuarioNombreRaw || undefined,
    });
  }
  return out.length ? out : undefined;
}

export function docToClient(sucursalId: string, id: string, d: Record<string, unknown>): Client {
  return {
    id,
    rfc: d.rfc != null ? String(d.rfc) : undefined,
    nombre: String(d.nombre ?? ''),
    razonSocial: d.razonSocial != null ? String(d.razonSocial) : undefined,
    codigoPostal: d.codigoPostal != null ? String(d.codigoPostal) : undefined,
    regimenFiscal: d.regimenFiscal != null ? String(d.regimenFiscal) : undefined,
    usoCfdi: d.usoCfdi != null ? String(d.usoCfdi) : undefined,
    email: d.email != null ? String(d.email) : undefined,
    telefono: d.telefono != null ? String(d.telefono) : undefined,
    direccion:
      d.direccion && typeof d.direccion === 'object'
        ? (d.direccion as Client['direccion'])
        : undefined,
    isMostrador: d.isMostrador === true,
    listaPreciosId:
      d.listaPreciosId != null && d.listaPreciosId !== ''
        ? normalizeClientPriceListId(d.listaPreciosId)
        : undefined,
    ticketsComprados:
      d.ticketsComprados != null && Number.isFinite(Number(d.ticketsComprados))
        ? Number(d.ticketsComprados)
        : undefined,
    ventasHistorial:
      d.ventasHistorial != null && Number.isFinite(Number(d.ventasHistorial))
        ? Math.max(0, Math.floor(Number(d.ventasHistorial)))
        : undefined,
    saldoAdeudado:
      d.saldoAdeudado != null && Number.isFinite(Number(d.saldoAdeudado))
        ? Math.max(0, Math.round(Number(d.saldoAdeudado) * 100) / 100)
        : undefined,
    ultimoAbonoMonto:
      d.ultimoAbonoMonto != null && Number.isFinite(Number(d.ultimoAbonoMonto))
        ? Math.max(0, Math.round(Number(d.ultimoAbonoMonto) * 100) / 100)
        : undefined,
    ultimoAbonoAt: d.ultimoAbonoAt != null ? firestoreTimestampToDate(d.ultimoAbonoAt) : undefined,
    ultimoAbonoSaldoAnterior:
      d.ultimoAbonoSaldoAnterior != null && Number.isFinite(Number(d.ultimoAbonoSaldoAnterior))
        ? Math.max(0, Math.round(Number(d.ultimoAbonoSaldoAnterior) * 100) / 100)
        : undefined,
    ultimoAbonoSaldoNuevo:
      d.ultimoAbonoSaldoNuevo != null && Number.isFinite(Number(d.ultimoAbonoSaldoNuevo))
        ? Math.max(0, Math.round(Number(d.ultimoAbonoSaldoNuevo) * 100) / 100)
        : undefined,
    ultimoAbonoUsuarioNombre:
      d.ultimoAbonoUsuarioNombre != null && String(d.ultimoAbonoUsuarioNombre).trim() !== ''
        ? String(d.ultimoAbonoUsuarioNombre).trim()
        : undefined,
    abonosHistorial: parseAbonosHistorialDoc(d.abonosHistorial),
    notasInternas:
      d.notasInternas != null && String(d.notasInternas).trim() !== ''
        ? String(d.notasInternas)
        : undefined,
    sucursalId,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

function clientToDocPayload(
  client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Record<string, unknown> {
  return {
    rfc: client.rfc ?? null,
    nombre: client.nombre,
    razonSocial: client.razonSocial ?? null,
    codigoPostal: client.codigoPostal ?? null,
    regimenFiscal: client.regimenFiscal ?? null,
    usoCfdi: client.usoCfdi ?? null,
    email: client.email ?? null,
    telefono: client.telefono ?? null,
    direccion: client.direccion ?? null,
    isMostrador: client.isMostrador === true,
    listaPreciosId: client.listaPreciosId ?? null,
    ticketsComprados: client.ticketsComprados ?? null,
    saldoAdeudado:
      client.saldoAdeudado != null && Number.isFinite(Number(client.saldoAdeudado))
        ? Math.max(0, Math.round(Number(client.saldoAdeudado) * 100) / 100)
        : null,
    sucursalId: client.sucursalId ?? null,
  };
}

export function subscribeClientsCatalog(
  sucursalId: string,
  onData: (clients: Client[]) => void,
  onMirrorLocal?: (clients: Client[]) => void | Promise<void>
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase.from('clients').select('id, doc').eq('sucursal_id', sucursalId);
    if (error) {
      console.error('subscribeClientsCatalog:', error);
      onData([]);
      return;
    }
    const list = (data ?? []).map((r) =>
      docToClient(sucursalId, r.id, r.doc as Record<string, unknown>)
    );
    list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    void onMirrorLocal?.(list);
    onData(list);
  };
  void load();
  const ch = supabase
    .channel(`clients-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'clients', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function createClientFirestore(
  sucursalId: string,
  client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>,
  id: string
): Promise<string> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const doc = {
    ...clientToDocPayload(client),
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('clients').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateClientFirestore(
  sucursalId: string,
  id: string,
  updates: Partial<Client>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('clients')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', id)
    .maybeSingle();
  const doc = { ...((row?.doc as Record<string, unknown>) ?? {}) };
  const now = new Date().toISOString();
  if (updates.nombre !== undefined) doc.nombre = updates.nombre;
  if (updates.rfc !== undefined) doc.rfc = updates.rfc ?? null;
  if (updates.razonSocial !== undefined) doc.razonSocial = updates.razonSocial ?? null;
  if (updates.codigoPostal !== undefined) doc.codigoPostal = updates.codigoPostal ?? null;
  if (updates.regimenFiscal !== undefined) doc.regimenFiscal = updates.regimenFiscal ?? null;
  if (updates.usoCfdi !== undefined) doc.usoCfdi = updates.usoCfdi ?? null;
  if (updates.email !== undefined) doc.email = updates.email ?? null;
  if (updates.telefono !== undefined) doc.telefono = updates.telefono ?? null;
  if (updates.direccion !== undefined) doc.direccion = updates.direccion ?? null;
  if (updates.isMostrador !== undefined) doc.isMostrador = updates.isMostrador;
  if (updates.listaPreciosId !== undefined) doc.listaPreciosId = updates.listaPreciosId ?? null;
  if (updates.ticketsComprados !== undefined) doc.ticketsComprados = updates.ticketsComprados ?? null;
  if (updates.ventasHistorial !== undefined) {
    const vh = updates.ventasHistorial;
    doc.ventasHistorial =
      vh != null && Number.isFinite(Number(vh)) ? Math.max(0, Math.floor(Number(vh))) : null;
  }
  if (updates.saldoAdeudado !== undefined) {
    const v = Number(updates.saldoAdeudado);
    doc.saldoAdeudado = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoAbonoMonto !== undefined) {
    const v = Number(updates.ultimoAbonoMonto);
    doc.ultimoAbonoMonto = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoAbonoAt !== undefined) {
    doc.ultimoAbonoAt = updates.ultimoAbonoAt ? new Date(updates.ultimoAbonoAt).toISOString() : null;
  }
  if (updates.ultimoAbonoSaldoAnterior !== undefined) {
    const v = Number(updates.ultimoAbonoSaldoAnterior);
    doc.ultimoAbonoSaldoAnterior = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoAbonoSaldoNuevo !== undefined) {
    const v = Number(updates.ultimoAbonoSaldoNuevo);
    doc.ultimoAbonoSaldoNuevo = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoAbonoUsuarioNombre !== undefined) {
    const t = updates.ultimoAbonoUsuarioNombre?.trim();
    doc.ultimoAbonoUsuarioNombre = t ? t : null;
  }
  if (updates.abonosHistorial !== undefined) {
    const arr = updates.abonosHistorial;
    doc.abonosHistorial =
      arr && arr.length > 0 ?
        arr.map((e) => ({
          at: new Date(e.at).toISOString(),
          monto: Math.max(0, Math.round(Number(e.monto) * 100) / 100),
          saldoAnterior: Math.max(0, Math.round(Number(e.saldoAnterior) * 100) / 100),
          saldoNuevo: Math.max(0, Math.round(Number(e.saldoNuevo) * 100) / 100),
          usuarioNombre: e.usuarioNombre?.trim() ? e.usuarioNombre.trim() : null,
        }))
      : null;
  }
  if (updates.notasInternas !== undefined) {
    const t = updates.notasInternas?.trim();
    doc.notasInternas = t ? t : null;
  }
  doc.updatedAt = now;
  const { error } = await supabase
    .from('clients')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteClientFirestore(sucursalId: string, id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('clients').delete().eq('sucursal_id', sucursalId).eq('id', id);
  if (error) throw new Error(error.message);
}
