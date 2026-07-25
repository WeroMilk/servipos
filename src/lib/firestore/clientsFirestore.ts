import type { CajaAbonoCobro, Client, ClientAbonoHistorialEntry, ClientCreditoHistorialEntry, FormaPago } from '@/types';
import { getMexicoDateKey } from '@/lib/quincenaMx';
import { normalizeClientPriceListId } from '@/lib/clientPriceLists';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
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
      formaPago:
        o.formaPago != null && String(o.formaPago).trim()
          ? (String(o.formaPago).trim() as ClientAbonoHistorialEntry['formaPago'])
          : undefined,
      cajaSesionId:
        o.cajaSesionId != null && String(o.cajaSesionId).trim()
          ? String(o.cajaSesionId).trim()
          : undefined,
      usuarioNombre: usuarioNombreRaw || undefined,
    });
  }
  return out.length ? out : undefined;
}

function parseCreditoHistorialDoc(raw: unknown): ClientCreditoHistorialEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ClientCreditoHistorialEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.at == null) continue;
    const at = firestoreTimestampToDate(o.at);
    const monto = Number(o.monto);
    if (!Number.isFinite(monto) || monto < 0) continue;
    const saldoAnt = Number(o.saldoAnterior);
    const saldoNvo = Number(o.saldoNuevo);
    const tipoRaw = String(o.tipo ?? 'emision');
    const tipo =
      tipoRaw === 'uso' || tipoRaw === 'ajuste' ? tipoRaw : ('emision' as const);
    out.push({
      at,
      monto: Math.max(0, Math.round(monto * 100) / 100),
      saldoAnterior:
        Number.isFinite(saldoAnt) ? Math.max(0, Math.round(saldoAnt * 100) / 100) : 0,
      saldoNuevo: Number.isFinite(saldoNvo) ? Math.max(0, Math.round(saldoNvo * 100) / 100) : 0,
      tipo,
      motivo: o.motivo != null ? String(o.motivo) : undefined,
      referencia: o.referencia != null ? String(o.referencia) : undefined,
      usuarioNombre:
        o.usuarioNombre != null && String(o.usuarioNombre).trim() !== ''
          ? String(o.usuarioNombre).trim()
          : undefined,
      notas: o.notas != null && String(o.notas).trim() !== '' ? String(o.notas) : undefined,
      cajaSesionId:
        o.cajaSesionId != null && String(o.cajaSesionId).trim()
          ? String(o.cajaSesionId).trim()
          : undefined,
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
    limiteCredito:
      d.limiteCredito != null && Number.isFinite(Number(d.limiteCredito))
        ? Math.max(0, Math.round(Number(d.limiteCredito) * 100) / 100)
        : null,
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
    saldoCreditoTienda:
      d.saldoCreditoTienda != null && Number.isFinite(Number(d.saldoCreditoTienda))
        ? Math.max(0, Math.round(Number(d.saldoCreditoTienda) * 100) / 100)
        : undefined,
    ultimoCreditoMonto:
      d.ultimoCreditoMonto != null && Number.isFinite(Number(d.ultimoCreditoMonto))
        ? Math.max(0, Math.round(Number(d.ultimoCreditoMonto) * 100) / 100)
        : undefined,
    ultimoCreditoAt:
      d.ultimoCreditoAt != null ? firestoreTimestampToDate(d.ultimoCreditoAt) : undefined,
    ultimoCreditoSaldoAnterior:
      d.ultimoCreditoSaldoAnterior != null && Number.isFinite(Number(d.ultimoCreditoSaldoAnterior))
        ? Math.max(0, Math.round(Number(d.ultimoCreditoSaldoAnterior) * 100) / 100)
        : undefined,
    ultimoCreditoSaldoNuevo:
      d.ultimoCreditoSaldoNuevo != null && Number.isFinite(Number(d.ultimoCreditoSaldoNuevo))
        ? Math.max(0, Math.round(Number(d.ultimoCreditoSaldoNuevo) * 100) / 100)
        : undefined,
    ultimoCreditoTipo:
      d.ultimoCreditoTipo === 'uso' || d.ultimoCreditoTipo === 'ajuste' || d.ultimoCreditoTipo === 'emision'
        ? d.ultimoCreditoTipo
        : undefined,
    ultimoCreditoMotivo:
      d.ultimoCreditoMotivo != null && String(d.ultimoCreditoMotivo).trim() !== ''
        ? String(d.ultimoCreditoMotivo).trim()
        : undefined,
    ultimoCreditoUsuarioNombre:
      d.ultimoCreditoUsuarioNombre != null && String(d.ultimoCreditoUsuarioNombre).trim() !== ''
        ? String(d.ultimoCreditoUsuarioNombre).trim()
        : undefined,
    creditoHistorial: parseCreditoHistorialDoc(d.creditoHistorial),
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
    limiteCredito:
      client.limiteCredito != null && Number.isFinite(Number(client.limiteCredito))
        ? Math.max(0, Math.round(Number(client.limiteCredito) * 100) / 100)
        : null,
    sucursalId: client.sucursalId ?? null,
  };
}

let lastClients: Client[] = [];
const clientsListeners = new Set<(clients: Client[]) => void>();
const clientsMirrorListeners = new Set<(clients: Client[]) => void | Promise<void>>();
let clientsChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let clientsSucursalId: string | null = null;
let clientsReloadDebounced: (() => void) | null = null;

export function getClientsCatalogSnapshot(): Client[] {
  return lastClients;
}

function notifyClientsListeners(list: Client[]): void {
  lastClients = list;
  clientsListeners.forEach((fn) => {
    try {
      fn([...list]);
    } catch (e) {
      console.error('subscribeClientsCatalog listener:', e);
    }
  });
  clientsMirrorListeners.forEach((fn) => {
    void fn([...list]);
  });
}

export function subscribeClientsCatalog(
  sucursalId: string,
  onData: (clients: Client[]) => void,
  onMirrorLocal?: (clients: Client[]) => void | Promise<void>
): () => void {
  onData([...lastClients]);
  clientsListeners.add(onData);
  if (onMirrorLocal) clientsMirrorListeners.add(onMirrorLocal);

  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase.from('clients').select('id, doc').eq('sucursal_id', sucursalId);
    if (error) {
      console.error('subscribeClientsCatalog:', error);
      if (lastClients.length > 0) {
        clientsListeners.forEach((fn) => {
          try {
            fn([...lastClients]);
          } catch (e) {
            console.error('subscribeClientsCatalog listener:', e);
          }
        });
        return;
      }
      notifyClientsListeners([]);
      return;
    }
    const list = (data ?? []).map((r) =>
      docToClient(sucursalId, r.id, r.doc as Record<string, unknown>)
    );
    list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    notifyClientsListeners(list);
  };

  if (clientsSucursalId !== sucursalId) {
    if (clientsChannel) {
      void supabase.removeChannel(clientsChannel);
      clientsChannel = null;
    }
    clientsSucursalId = sucursalId;
    clientsReloadDebounced = createDebouncedAsyncFn(load, 500);
    lastClients = [];
    notifyClientsListeners([]);
    void load();
    clientsChannel = supabase
      .channel(`clients-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clients', filter: `sucursal_id=eq.${sucursalId}` },
        () => {
          clientsReloadDebounced?.();
        }
      )
      .subscribe();
  } else {
    try {
      onData([...lastClients]);
    } catch (e) {
      console.error('subscribeClientsCatalog (resync existing):', e);
    }
  }

  return () => {
    clientsListeners.delete(onData);
    if (onMirrorLocal) clientsMirrorListeners.delete(onMirrorLocal);
    // Mantener canal y caché en sesión: evita refetch completo al volver a una pantalla.
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
  if (updates.limiteCredito !== undefined) {
    const v = updates.limiteCredito;
    doc.limiteCredito =
      v == null || !Number.isFinite(Number(v))
        ? null
        : Math.max(0, Math.round(Number(v) * 100) / 100);
  }
  if (updates.ultimoAbonoMonto !== undefined) {
    const v = updates.ultimoAbonoMonto;
    doc.ultimoAbonoMonto =
      v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 100) / 100);
  }
  if (updates.ultimoAbonoAt !== undefined) {
    doc.ultimoAbonoAt = updates.ultimoAbonoAt ? new Date(updates.ultimoAbonoAt).toISOString() : null;
  }
  if (updates.ultimoAbonoSaldoAnterior !== undefined) {
    const v = updates.ultimoAbonoSaldoAnterior;
    doc.ultimoAbonoSaldoAnterior =
      v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 100) / 100);
  }
  if (updates.ultimoAbonoSaldoNuevo !== undefined) {
    const v = updates.ultimoAbonoSaldoNuevo;
    doc.ultimoAbonoSaldoNuevo =
      v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 100) / 100);
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
          formaPago: e.formaPago ?? null,
          cajaSesionId: e.cajaSesionId?.trim() ? e.cajaSesionId.trim() : null,
          usuarioNombre: e.usuarioNombre?.trim() ? e.usuarioNombre.trim() : null,
        }))
      : null;
  }
  if (updates.saldoCreditoTienda !== undefined) {
    const v = Number(updates.saldoCreditoTienda);
    doc.saldoCreditoTienda = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoCreditoMonto !== undefined) {
    const v = Number(updates.ultimoCreditoMonto);
    doc.ultimoCreditoMonto = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoCreditoAt !== undefined) {
    doc.ultimoCreditoAt = updates.ultimoCreditoAt ? new Date(updates.ultimoCreditoAt).toISOString() : null;
  }
  if (updates.ultimoCreditoSaldoAnterior !== undefined) {
    const v = Number(updates.ultimoCreditoSaldoAnterior);
    doc.ultimoCreditoSaldoAnterior = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoCreditoSaldoNuevo !== undefined) {
    const v = Number(updates.ultimoCreditoSaldoNuevo);
    doc.ultimoCreditoSaldoNuevo = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : null;
  }
  if (updates.ultimoCreditoTipo !== undefined) {
    doc.ultimoCreditoTipo = updates.ultimoCreditoTipo ?? null;
  }
  if (updates.ultimoCreditoMotivo !== undefined) {
    const t = updates.ultimoCreditoMotivo?.trim();
    doc.ultimoCreditoMotivo = t ? t : null;
  }
  if (updates.ultimoCreditoUsuarioNombre !== undefined) {
    const t = updates.ultimoCreditoUsuarioNombre?.trim();
    doc.ultimoCreditoUsuarioNombre = t ? t : null;
  }
  if (updates.creditoHistorial !== undefined) {
    const arr = updates.creditoHistorial;
    doc.creditoHistorial =
      arr && arr.length > 0 ?
        arr.map((e) => ({
          at: new Date(e.at).toISOString(),
          monto: Math.max(0, Math.round(Number(e.monto) * 100) / 100),
          saldoAnterior: Math.max(0, Math.round(Number(e.saldoAnterior) * 100) / 100),
          saldoNuevo: Math.max(0, Math.round(Number(e.saldoNuevo) * 100) / 100),
          tipo: e.tipo === 'uso' || e.tipo === 'ajuste' ? e.tipo : 'emision',
          motivo: e.motivo?.trim() ? e.motivo.trim() : null,
          referencia: e.referencia?.trim() ? e.referencia.trim() : null,
          usuarioNombre: e.usuarioNombre?.trim() ? e.usuarioNombre.trim() : null,
          notas: e.notas?.trim() ? e.notas.trim() : null,
          cajaSesionId: e.cajaSesionId?.trim() ? e.cajaSesionId.trim() : null,
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

/**
 * Abonos CxC del historial de clientes etiquetados con esta sesión de caja.
 * Sirve de respaldo cuando `caja_sesiones.abonosCobros` quedó vacío (RPC fallido, etc.).
 * También incluye abonos sin `cajaSesionId` del mismo día (zona Hermosillo) que el turno,
 * y el legado `ultimoAbono*` si no hay `abonosHistorial`.
 */
export async function listAbonosHistorialByCajaSesionFirestore(
  sucursalId: string,
  sesionId: string,
  ventana?: { from: Date; to: Date } | null,
  opts?: {
    knownSesionIds?: Iterable<string> | null;
    /** Sesiones cuyo doc.abonosCobros está vacío (RPC fallido): permite recuperar abonos etiquetados a ellas. */
    emptyAbonosSesionIds?: Iterable<string> | null;
    /** Si el turno actual tampoco tiene abonosCobros, incluir abonos del día etiquetados a sesiones vacías. */
    recoverTaggedOnEmptySesion?: boolean;
  }
): Promise<CajaAbonoCobro[]> {
  const sid = sesionId.trim();
  if (!sid) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('clients').select('id, doc').eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);

  const fromMs = ventana?.from?.getTime() ?? null;
  const toMs = ventana?.to?.getTime() ?? null;
  const dayKey =
    ventana?.from && Number.isFinite(ventana.from.getTime())
      ? getMexicoDateKey(ventana.from)
      : null;
  const knownSesionIdSet = new Set(
    [...(opts?.knownSesionIds ?? [])].map((id) => String(id).trim()).filter(Boolean)
  );
  const emptyAbonosSesionIdSet = new Set(
    [...(opts?.emptyAbonosSesionIds ?? [])].map((id) => String(id).trim()).filter(Boolean)
  );
  const recoverTagged = opts?.recoverTaggedOnEmptySesion === true;

  const out: CajaAbonoCobro[] = [];
  const pushHist = (
    client: Client,
    h: {
      at: Date;
      monto: number;
      formaPago?: FormaPago;
      cajaSesionId?: string;
      usuarioNombre?: string;
    }
  ) => {
    const monto = Math.round((Number(h.monto) || 0) * 100) / 100;
    if (monto <= 0.005) return;
    const at = h.at instanceof Date ? h.at : new Date(h.at);
    if (!Number.isFinite(at.getTime())) return;
    const histSid = (h.cajaSesionId ?? '').trim();
    const matchSesion = histSid === sid;
    // Sin cajaSesionId: abonos del mismo día del turno (Hermosillo).
    const matchMismoDia =
      !histSid &&
      dayKey != null &&
      getMexicoDateKey(at) === dayKey &&
      (toMs == null || at.getTime() <= toMs);
    const matchVentana =
      !histSid &&
      fromMs != null &&
      toMs != null &&
      at.getTime() >= fromMs &&
      at.getTime() <= toMs;
    // Sesión etiquetada que ya no está en el historial de turnos: recuperar en el día.
    const matchHuerfanoMismoDia =
      Boolean(histSid) &&
      histSid !== sid &&
      dayKey != null &&
      getMexicoDateKey(at) === dayKey &&
      knownSesionIdSet.size > 0 &&
      !knownSesionIdSet.has(histSid);
    // Abono etiquetado a otro turno del mismo día cuyo corte también quedó sin abonosCobros
    // (RPC falló): recuperarlo al ver este turno si también está vacío.
    const matchTaggedEmptySameDay =
      recoverTagged &&
      Boolean(histSid) &&
      histSid !== sid &&
      dayKey != null &&
      getMexicoDateKey(at) === dayKey &&
      emptyAbonosSesionIdSet.has(histSid) &&
      emptyAbonosSesionIdSet.has(sid);
    if (
      !matchSesion &&
      !matchMismoDia &&
      !matchVentana &&
      !matchHuerfanoMismoDia &&
      !matchTaggedEmptySameDay
    ) {
      return;
    }
    const formaPago = (h.formaPago?.trim() || '01') as FormaPago;
    out.push({
      id: `hist:${client.id}:${at.toISOString()}:${Math.round(monto * 100)}`,
      monto,
      formaPago,
      clienteId: client.id,
      clienteNombre: client.nombre,
      createdAt: at,
      usuarioId: '',
      usuarioNombre: h.usuarioNombre?.trim() || '—',
    });
  };

  for (const row of data ?? []) {
    const client = docToClient(sucursalId, row.id, (row.doc ?? {}) as Record<string, unknown>);
    const hist = client.abonosHistorial ?? [];
    if (hist.length > 0) {
      for (const h of hist) pushHist(client, h);
    } else if (client.ultimoAbonoAt != null && client.ultimoAbonoMonto != null) {
      pushHist(client, {
        at:
          client.ultimoAbonoAt instanceof Date
            ? client.ultimoAbonoAt
            : new Date(client.ultimoAbonoAt),
        monto: Number(client.ultimoAbonoMonto) || 0,
        formaPago: undefined,
        cajaSesionId: undefined,
        usuarioNombre: client.ultimoAbonoUsuarioNombre,
      });
    }
  }
  out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return out;
}
