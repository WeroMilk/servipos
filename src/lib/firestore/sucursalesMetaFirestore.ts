import { DEFAULT_SUCURSAL_IDS } from '@/lib/sucursales';
import type { Sucursal } from '@/types';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date();
}

function nombreDisplayFromId(id: string): string {
  const t = id.replace(/_/g, ' ').trim();
  if (!t) return id;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isGarbageDisplayToken(s: string): boolean {
  const n = s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    n === 'true' ||
    n === 'false' ||
    n === 'verdadero' ||
    n === 'falso' ||
    n === 'yes' ||
    n === 'no' ||
    n === 'si' ||
    n === 'sí'
  );
}

function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function optionalCodigo(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0 || isGarbageDisplayToken(t)) return undefined;
  return t;
}

/** Metadatos de sucursal (tabla `public.sucursales` o documento Firestore migrado). */
export function docToSucursal(id: string, d: Record<string, unknown>): Sucursal {
  const rawNombre = firstNonEmptyString(
    d.nombre,
    d.name,
    d.nombreSucursal,
    d.titulo,
    d.displayName,
    d.label
  );
  const nombre =
    rawNombre && !isGarbageDisplayToken(rawNombre)
      ? rawNombre
      : nombreDisplayFromId(id);
  return {
    id,
    nombre,
    codigo: optionalCodigo(d.codigo),
    activo: d.activo !== false && d.activa !== false,
    createdAt: tsToDate(d.createdAt ?? d.created_at),
    updatedAt: tsToDate(d.updatedAt ?? d.updated_at),
  };
}

function mergeWithDefaultIds(fromFs: Sucursal[]): Sucursal[] {
  const byId = new Map(fromFs.map((s) => [s.id, s] as const));
  const ids = [...new Set([...DEFAULT_SUCURSAL_IDS, ...fromFs.map((s) => s.id)])];
  const epoch = new Date(0);
  const merged = ids.map(
    (id) =>
      byId.get(id) ?? {
        id,
        nombre: id,
        activo: true,
        createdAt: epoch,
        updatedAt: epoch,
      }
  );
  merged.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return merged;
}

function rowToRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    nombre: row.nombre,
    codigo: row.codigo,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeSucursales(onList: (list: Sucursal[]) => void): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase.from('sucursales').select('*');
    if (error) {
      console.error('Sucursales:', error);
      onList(mergeWithDefaultIds([]));
      return;
    }
    const fromFs: Sucursal[] = (data ?? []).map((row) =>
      docToSucursal(String(row.id), rowToRecord(row as Record<string, unknown>))
    );
    onList(mergeWithDefaultIds(fromFs));
  };
  void load();
  const ch = supabase
    .channel('sucursales-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sucursales' }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export function subscribeSucursalesCatalog(onList: (list: Sucursal[]) => void): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase.from('sucursales').select('*');
    if (error) {
      console.error('Sucursales:', error);
      onList([]);
      return;
    }
    const list = (data ?? []).map((row) =>
      docToSucursal(String(row.id), rowToRecord(row as Record<string, unknown>))
    );
    list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    onList(list);
  };
  void load();
  const ch = supabase
    .channel('sucursales-catalog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sucursales' }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

function slugSucursalDocId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return (s.length > 0 ? s : 'sucursal').slice(0, 64);
}

export async function createSucursalMeta(input: {
  id?: string;
  nombre: string;
  codigo?: string;
}): Promise<string> {
  const id = slugSucursalDocId(input.id || input.nombre);
  const supabase = getSupabase();
  const { data: existing } = await supabase.from('sucursales').select('id').eq('id', id).maybeSingle();
  if (existing) {
    throw new Error(`Ya existe una sucursal con el id "${id}"`);
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from('sucursales').insert({
    id,
    nombre: input.nombre.trim(),
    codigo: input.codigo?.trim() || null,
    activo: true,
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateSucursalMeta(
  id: string,
  patch: { nombre?: string; codigo?: string | null; activo?: boolean }
): Promise<void> {
  const supabase = getSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.nombre !== undefined) row.nombre = patch.nombre.trim();
  if (patch.codigo !== undefined) row.codigo = patch.codigo === null || patch.codigo === '' ? null : patch.codigo.trim();
  if (patch.activo !== undefined) row.activo = patch.activo;
  const { error } = await supabase.from('sucursales').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function softDeleteSucursal(id: string): Promise<void> {
  await updateSucursalMeta(id, { activo: false });
}

export async function reactivateSucursal(id: string): Promise<void> {
  await updateSucursalMeta(id, { activo: true });
}

const BRANCH_TABLES = [
  'sales',
  'inventory_movements',
  'products',
  'counters',
  'clients',
  'fiscal_config',
  'caja_estado',
  'caja_sesiones',
  'outgoing_transfers',
  'incoming_transfers',
] as const;

export async function hardDeleteSucursal(sucursalId: string): Promise<void> {
  const id = sucursalId.trim();
  if (!id) throw new Error('Id de sucursal inválido');

  const supabase = getSupabase();
  const { data: meta } = await supabase.from('sucursales').select('activo').eq('id', id).maybeSingle();
  if (meta && meta.activo !== false) {
    throw new Error('Desactive la sucursal antes de eliminarla por completo');
  }

  for (const table of BRANCH_TABLES) {
    const { error } = await supabase.from(table).delete().eq('sucursal_id', id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  const { data: allChec } = await supabase.from('checador_registros').select('id, doc');
  for (const row of allChec ?? []) {
    const sid = (row.doc as { sucursalId?: string } | undefined)?.sucursalId;
    if (sid === id) {
      await supabase.from('checador_registros').delete().eq('id', row.id);
    }
  }

  await supabase
    .from('profiles')
    .update({ sucursal_id: null, updated_at: new Date().toISOString() })
    .eq('sucursal_id', id);

  const { error: delMeta } = await supabase.from('sucursales').delete().eq('id', id);
  if (delMeta) throw new Error(delMeta.message);
}
