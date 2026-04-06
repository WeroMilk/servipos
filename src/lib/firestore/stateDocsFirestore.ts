import { getSupabase } from '@/lib/supabaseClient';

export async function getSucursalStateDocOnce<T>(
  sucursalId: string,
  docKey: string
): Promise<T | null> {
  const sid = sucursalId.trim();
  const key = docKey.trim();
  if (!sid || !key) return null;
  const { data, error } = await getSupabase()
    .from('sucursal_state_docs')
    .select('doc')
    .eq('sucursal_id', sid)
    .eq('doc_key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.doc as T | undefined) ?? null;
}

export async function saveSucursalStateDoc<T>(
  sucursalId: string,
  docKey: string,
  doc: T
): Promise<void> {
  const sid = sucursalId.trim();
  const key = docKey.trim();
  if (!sid || !key) throw new Error('Sucursal/clave de documento inválida');
  const now = new Date().toISOString();
  const { error } = await getSupabase().from('sucursal_state_docs').upsert({
    sucursal_id: sid,
    doc_key: key,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
}

export async function getUserStateDocOnce<T>(
  sucursalId: string,
  userId: string,
  docKey: string
): Promise<T | null> {
  const sid = sucursalId.trim();
  const uid = userId.trim();
  const key = docKey.trim();
  if (!sid || !uid || !key) return null;
  const { data, error } = await getSupabase()
    .from('user_state_docs')
    .select('doc')
    .eq('sucursal_id', sid)
    .eq('user_id', uid)
    .eq('doc_key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.doc as T | undefined) ?? null;
}

export async function saveUserStateDoc<T>(
  sucursalId: string,
  userId: string,
  docKey: string,
  doc: T
): Promise<void> {
  const sid = sucursalId.trim();
  const uid = userId.trim();
  const key = docKey.trim();
  if (!sid || !uid || !key) throw new Error('Sucursal/usuario/clave de documento inválida');
  const now = new Date().toISOString();
  const { error } = await getSupabase().from('user_state_docs').upsert({
    sucursal_id: sid,
    user_id: uid,
    doc_key: key,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
}

export async function probeSucursalCloudRoundtrip(sucursalId: string): Promise<void> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal activa');
  const { error } = await getSupabase()
    .from('sucursales')
    .select('id')
    .eq('id', sid)
    .limit(1);
  if (error) throw new Error(error.message);
}
