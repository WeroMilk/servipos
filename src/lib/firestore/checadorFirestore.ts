import type { ChecadorDiaRegistro, User } from '@/types';
import { getMexicoDateKey, quincenaIdFromDateKey } from '@/lib/quincenaMx';
import { getSupabase } from '@/lib/supabaseClient';

const COL = 'checador_registros';

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (
    v &&
    typeof v === 'object' &&
    'toDate' in v &&
    typeof (v as { toDate: () => Date }).toDate === 'function'
  ) {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return null;
}

export function checadorDocId(userId: string, dateKey: string): string {
  return `${userId}_${dateKey}`;
}

export function resolveRegistroSucursalId(user: User, effectiveSucursalId?: string): string | null {
  const ctx = effectiveSucursalId?.trim();
  if (ctx) return ctx;
  const p = user.sucursalId?.trim();
  return p || null;
}

export function filterChecadorRowsBySucursal(
  rows: ChecadorDiaRegistro[],
  sucursalId: string,
  userSucursalByUid: ReadonlyMap<string, string | undefined>
): ChecadorDiaRegistro[] {
  const sid = sucursalId.trim();
  if (!sid) return rows;
  return rows.filter((row) => {
    const onRecord = row.sucursalId?.trim();
    if (onRecord) return onRecord === sid;
    const fromProfile = userSucursalByUid.get(row.userId)?.trim();
    return !!fromProfile && fromProfile === sid;
  });
}

export function docToChecadorDia(id: string, d: Record<string, unknown>): ChecadorDiaRegistro {
  return {
    id,
    userId: String(d.userId ?? ''),
    userName: String(d.userName ?? ''),
    userEmail: String(d.userEmail ?? ''),
    dateKey: String(d.dateKey ?? ''),
    quincenaId: String(d.quincenaId ?? ''),
    sucursalId: typeof d.sucursalId === 'string' ? d.sucursalId : undefined,
    entrada: tsToDate(d.entrada),
    salidaComer: tsToDate(d.salidaComer),
    regresoComer: tsToDate(d.regresoComer),
    cierre: tsToDate(d.cierre),
  };
}

async function getDocRow(id: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from(COL).select('doc').eq('id', id).maybeSingle();
  return (data?.doc as Record<string, unknown>) ?? null;
}

async function upsertDoc(id: string, doc: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  doc.updatedAt = now;
  const { error } = await supabase.from(COL).upsert({
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
}

export function subscribeChecadorDia(
  userId: string,
  dateKey: string,
  onData: (row: ChecadorDiaRegistro | null) => void
): () => void {
  const id = checadorDocId(userId, dateKey);
  const supabase = getSupabase();
  const load = async () => {
    const { data } = await supabase.from(COL).select('id, doc').eq('id', id).maybeSingle();
    if (!data?.doc) {
      onData(null);
      return;
    }
    onData(docToChecadorDia(data.id, data.doc as Record<string, unknown>));
  };
  void load();
  const ch = supabase
    .channel(`checador-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: COL, filter: `id=eq.${id}` }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function punchEntrada(user: User, effectiveSucursalId?: string): Promise<void> {
  const dateKey = getMexicoDateKey();
  const quincenaId = quincenaIdFromDateKey(dateKey);
  const id = checadorDocId(user.id, dateKey);
  const prev = await getDocRow(id);
  if (prev) {
    if (prev.entrada && !prev.cierre) {
      throw new Error('Ya registró su entrada hoy');
    }
    if (prev.cierre) {
      throw new Error(
        'La jornada está cerrada. Use «Iniciar jornada de nuevo» para registrar otro turno el mismo día.'
      );
    }
  }
  const now = new Date().toISOString();
  await upsertDoc(id, {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    dateKey,
    quincenaId,
    sucursalId: resolveRegistroSucursalId(user, effectiveSucursalId),
    entrada: now,
    salidaComer: null,
    regresoComer: null,
    cierre: null,
  });
}

export async function punchSalidaComer(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const data = await getDocRow(id);
  if (!data?.entrada) {
    throw new Error('Registre su entrada primero');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  if (data.salidaComer) {
    throw new Error('Ya registró salida a comer');
  }
  const now = new Date().toISOString();
  await upsertDoc(id, { ...data, salidaComer: now });
}

export async function punchRegresoComer(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const data = await getDocRow(id);
  if (!data?.salidaComer) {
    throw new Error('Registre salida a comer primero');
  }
  if (data.regresoComer) {
    throw new Error('Ya registró su regreso de comer');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  const now = new Date().toISOString();
  await upsertDoc(id, { ...data, regresoComer: now });
}

export async function reiniciarJornadaMismoDia(user: User, effectiveSucursalId?: string): Promise<void> {
  const dateKey = getMexicoDateKey();
  const quincenaId = quincenaIdFromDateKey(dateKey);
  const id = checadorDocId(user.id, dateKey);
  const snap = await getDocRow(id);
  if (!snap?.cierre) {
    throw new Error('Solo puede reiniciar después de cerrar la jornada');
  }
  const bloque = {
    entrada: snap.entrada ?? null,
    salidaComer: snap.salidaComer ?? null,
    regresoComer: snap.regresoComer ?? null,
    cierre: snap.cierre ?? null,
  };
  const prevJ = Array.isArray(snap.jornadasCompletadas) ? [...(snap.jornadasCompletadas as unknown[])] : [];
  prevJ.push(bloque);
  await upsertDoc(id, {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    dateKey,
    quincenaId,
    sucursalId: resolveRegistroSucursalId(user, effectiveSucursalId),
    jornadasCompletadas: prevJ,
    entrada: null,
    salidaComer: null,
    regresoComer: null,
    cierre: null,
  });
}

export async function punchCierre(user: User): Promise<void> {
  const dateKey = getMexicoDateKey();
  const id = checadorDocId(user.id, dateKey);
  const data = await getDocRow(id);
  if (!data?.entrada) {
    throw new Error('Registre su entrada primero');
  }
  if (data.salidaComer && !data.regresoComer) {
    throw new Error('Regrese de comer antes de cerrar el día');
  }
  if (data.cierre) {
    throw new Error('El día ya está cerrado');
  }
  const now = new Date().toISOString();
  await upsertDoc(id, { ...data, cierre: now });
}

function sortChecadorRows(list: ChecadorDiaRegistro[]): ChecadorDiaRegistro[] {
  const next = [...list];
  next.sort((a, b) => {
    const dc = b.dateKey.localeCompare(a.dateKey);
    if (dc !== 0) return dc;
    return a.userName.localeCompare(b.userName, 'es', { sensitivity: 'base' });
  });
  return next;
}

export async function fetchChecadorByQuincena(quincenaId: string): Promise<ChecadorDiaRegistro[]> {
  const supabase = getSupabase();
  const { data: rows } = await supabase.from(COL).select('id, doc');
  const list = (rows ?? [])
    .filter((r) => String((r.doc as { quincenaId?: string })?.quincenaId ?? '') === quincenaId)
    .map((r) => docToChecadorDia(r.id, r.doc as Record<string, unknown>));
  return sortChecadorRows(list);
}

export function subscribeChecadorByQuincena(
  quincenaId: string,
  onData: (rows: ChecadorDiaRegistro[]) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data: rows, error } = await supabase.from(COL).select('id, doc');
    if (error) {
      console.error('subscribeChecadorByQuincena:', error);
      onData([]);
      return;
    }
    const list = (rows ?? [])
      .filter((r) => String((r.doc as { quincenaId?: string })?.quincenaId ?? '') === quincenaId)
      .map((r) => docToChecadorDia(r.id, r.doc as Record<string, unknown>));
    onData(sortChecadorRows(list));
  };
  void load();
  const ch = supabase
    .channel(`checador-q-${quincenaId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: COL }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
