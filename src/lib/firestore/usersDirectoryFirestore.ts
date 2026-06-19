import type { Permission, User, UserRole } from '@/types';
import { mapProfileRowToUser } from '@/lib/mapFirestoreUser';
import { getSupabase } from '@/lib/supabaseClient';

export type LoginDirectoryUser = {
  id: string;
  name: string;
  email: string;
};

function mapLoginDirectoryRows(
  rows: { id: string; name: string | null; email: string | null }[]
): LoginDirectoryUser[] {
  return rows
    .filter((r) => typeof r.email === 'string' && r.email.length > 0)
    .map((r) => ({
      id: r.id,
      name: (r.name ?? '').trim() || (r.email as string),
      email: (r.email as string).trim().toLowerCase(),
    }));
}

async function fetchLoginDirectoryViaRest(base: string, anonKey: string): Promise<LoginDirectoryUser[]> {
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
        console.warn('rpc_list_login_directory (REST):', res.status, detail.slice(0, 300));
      }
      return [];
    }
    const parsed = (await res.json()) as unknown;
    const rows = (Array.isArray(parsed) ? parsed : []) as { id: string; name: string | null; email: string | null }[];
    return mapLoginDirectoryRows(rows);
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('fetchLoginDirectoryViaRest:', e);
    }
    return [];
  }
}

/**
 * Directorio de login: primero Edge Function `list-login-directory` (service_role, sin JWT PostgREST).
 * Si no está desplegada (404) o falla, intenta REST con anon (p. ej. local sin functions).
 */
export async function fetchLoginDirectoryUsers(): Promise<LoginDirectoryUser[]> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!base || !anonKey) {
    if (import.meta.env.DEV) {
      console.warn('fetchLoginDirectoryUsers: faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY');
    }
    return [];
  }
  const root = base.replace(/\/$/, '');
  const edgeUrl = `${root}/functions/v1/list-login-directory`;
  const anonHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  } as const;

  try {
    const edgeRes = await fetch(edgeUrl, {
      method: 'POST',
      headers: { ...anonHeaders },
      body: '{}',
    });
    if (edgeRes.ok) {
      const parsed = (await edgeRes.json()) as { users?: unknown };
      const raw = parsed.users;
      if (Array.isArray(raw)) {
        const rows = raw as { id: string; name: string | null; email: string | null }[];
        return mapLoginDirectoryRows(rows);
      }
      return fetchLoginDirectoryViaRest(base, anonKey);
    }
    if (import.meta.env.DEV && edgeRes.status === 403) {
      console.warn(
        'list-login-directory (Edge): 403 Origin. Añada su URL a ADMIN_CREATE_USER_ALLOWED_ORIGINS en Supabase (véase docs/VERCEL.md).'
      );
    } else if (import.meta.env.DEV) {
      const t = await edgeRes.text().catch(() => '');
      console.warn('list-login-directory (Edge):', edgeRes.status, t.slice(0, 200));
    }
    if (edgeRes.status === 404 || edgeRes.status >= 500) {
      return fetchLoginDirectoryViaRest(base, anonKey);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('list-login-directory (Edge) red/error → REST:', e);
    }
    return fetchLoginDirectoryViaRest(base, anonKey);
  }

  return fetchLoginDirectoryViaRest(base, anonKey);
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

  const url = `${base.replace(/\/$/, '')}/functions/v1/admin-create-user`;
  let res: Response;
  try {
    res = await fetch(url, {
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
  } catch {
    throw new Error(
      'No se pudo contactar al servidor (admin-create-user). Revise conexión, que la Edge Function esté desplegada y que su dominio figure en ADMIN_CREATE_USER_ALLOWED_ORIGINS en Supabase.'
    );
  }

  let json: { uid?: string; error?: string };
  try {
    json = (await res.json()) as { uid?: string; error?: string };
  } catch {
    throw new Error(
      res.ok
        ? 'Respuesta inválida del servidor al crear usuario'
        : `Error del servidor (${res.status}) al crear usuario`
    );
  }

  if (!res.ok || !json.uid) {
    if (res.status === 403 && json.error?.toLowerCase().includes('origin')) {
      throw new Error(
        'Origen no permitido: agregue la URL de esta app a ADMIN_CREATE_USER_ALLOWED_ORIGINS en Supabase Edge Functions.'
      );
    }
    throw new Error(json.error ?? 'No se pudo crear el usuario (¿desplegó la Edge Function admin-create-user?)');
  }
  return json.uid;
}
