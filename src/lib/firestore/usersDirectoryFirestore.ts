import type { Permission, User, UserRole } from '@/types';
import { mapProfileRowToUser } from '@/lib/mapFirestoreUser';
import { getSupabase } from '@/lib/supabaseClient';

export type LoginDirectoryUser = {
  id: string;
  name: string;
  email: string;
};

/** Directorio de login (activos); `fetch` con anon key para evitar segundo GoTrueClient y JWT de sesión en el RPC. */
export async function fetchLoginDirectoryUsers(): Promise<LoginDirectoryUser[]> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anonKey) {
    if (import.meta.env.DEV) {
      console.warn('fetchLoginDirectoryUsers: faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY');
    }
    return [];
  }
  const url = `${base.replace(/\/$/, '')}/rest/v1/rpc/rpc_list_login_directory`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      if (import.meta.env.DEV) {
        const detail = await res.text().catch(() => '');
        console.warn('rpc_list_login_directory:', res.status, detail.slice(0, 300));
      }
      return [];
    }
    const parsed = (await res.json()) as unknown;
    const rows = (Array.isArray(parsed) ? parsed : []) as { id: string; name: string | null; email: string | null }[];
    return rows
      .filter((r) => typeof r.email === 'string' && r.email.length > 0)
      .map((r) => ({
        id: r.id,
        name: (r.name ?? '').trim() || (r.email as string),
        email: (r.email as string).trim().toLowerCase(),
      }));
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('fetchLoginDirectoryUsers:', e);
    }
    return [];
  }
}

/** Lista usuarios con perfil en `public.profiles`. */
export function subscribeFirestoreDirectoryUsers(onList: (list: User[]) => void): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('name');
    if (error) {
      console.error('Users directory:', error);
      onList([]);
      return;
    }
    const list = (data ?? []).map((row) => mapProfileRowToUser(row as Parameters<typeof mapProfileRowToUser>[0]));
    list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    onList(list);
  };
  void load();
  const channel = supabase
    .channel('profiles-directory')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function fetchFirestoreDirectoryUsersOnce(): Promise<User[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('profiles').select('*').order('name');
  if (error) {
    console.error('Users directory:', error);
    return [];
  }
  const list = (data ?? []).map((row) => mapProfileRowToUser(row as Parameters<typeof mapProfileRowToUser>[0]));
  list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return list;
}

export async function updateFirestoreDirectoryUser(
  uid: string,
  patch: {
    name?: string;
    username?: string;
    email?: string;
    role?: UserRole;
    isActive?: boolean;
    sucursalId?: string | null;
    useCustomPermissions?: boolean;
    customPermissions?: Permission[] | null;
  }
): Promise<void> {
  const supabase = getSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.sucursalId !== undefined) {
    row.sucursal_id = patch.sucursalId === null || patch.sucursalId === '' ? null : patch.sucursalId;
  }
  if (patch.useCustomPermissions !== undefined) {
    row.use_custom_permissions = patch.useCustomPermissions;
    if (patch.useCustomPermissions === false) {
      row.custom_permissions = [];
    }
  }
  if (patch.customPermissions !== undefined) {
    if (patch.customPermissions === null) {
      row.custom_permissions = [];
    } else {
      row.custom_permissions = patch.customPermissions;
    }
  }
  const { error } = await supabase.from('profiles').update(row).eq('id', uid);
  if (error) throw new Error(error.message);
}

/**
 * Crea usuario vía Edge Function `admin-create-user` (requiere desplegar en Supabase).
 */
export async function createAuthUserAndProfile(input: {
  email: string;
  password: string;
  name: string;
  username?: string;
  role: UserRole;
  sucursalId?: string | null;
}): Promise<string> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error('Falta VITE_SUPABASE_URL');
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesión requerida para crear usuarios');

  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/admin-create-user`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      name: input.name.trim(),
      username:
        input.username?.trim() ||
        (input.email.includes('@') ? input.email.split('@')[0]! : input.email),
      role: input.role,
      sucursalId: input.sucursalId && input.sucursalId.length > 0 ? input.sucursalId : null,
    }),
  });
  const json = (await res.json()) as { uid?: string; error?: string };
  if (!res.ok || !json.uid) {
    throw new Error(json.error ?? 'No se pudo crear el usuario (¿desplegó la Edge Function admin-create-user?)');
  }
  return json.uid;
}
