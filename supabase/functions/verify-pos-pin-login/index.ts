/// <reference path="../edge-runtime.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authPasswordFromPosPin } from '../_shared/authPasswordFromPosPin.ts';
import { expandServipartzEmailAliases } from '../_shared/servipartzEmailCandidates.ts';

/**
 * Códigos de error (estables) para mapear con logs de Edge y pestaña Red del navegador.
 * | code | HTTP | Significado |
 * | ORIGIN_NOT_ALLOWED | 403 | Añadir origen a ADMIN_CREATE_USER_ALLOWED_ORIGINS (o localhost / *.vercel.app). |
 * | INVALID_JSON / INVALID_BODY | 400 | Cuerpo o email/PIN inválido. |
 * | PROFILE_QUERY_FAILED | 500 | Error al leer profiles (RPC security definer o REST). |
 * | NO_PROFILE_FOR_EMAIL | 401 | No hay fila profiles para ese email. |
 * | DUPLICATE_EMAIL | 409 | Más de un perfil con el mismo email. |
 * | PROFILE_INACTIVE_OR_NO_PIN | 401 | is_active false o pos_pin vacío. |
 * | BAD_PIN | 401 | PIN no coincide con pos_pin. |
 * | AUTH_USER_NOT_RESOLVED | 500 | No se pudo obtener id de Auth para actualizar contraseña. |
 * | AUTH_UPDATE_FAILED | 500 | Sin éxito ni por SDK ni por REST admin (`PUT`/`PATCH` users). |
 * | MISSING_SUPABASE_ENV | 500 | Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el runtime. |
 * | INTERNAL | 500 | Excepción no controlada. |
 */
function errPayload(code: string, message: string): { code: string; error: string } {
  return { code, error: message };
}

const baseCorsHeaders: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function parseAllowedOrigins(): string[] {
  const raw = Deno.env.get('ADMIN_CREATE_USER_ALLOWED_ORIGINS') ?? '';
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Orígenes típicos de desarrollo y Vercel (*.vercel.app). Si usa dominio propio
 * (ej. https://pos.su-dominio.com), añádalo a `ADMIN_CREATE_USER_ALLOWED_ORIGINS` en Supabase.
 */
function isTrustedDefaultOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true;
    }
    if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Origen permitido si coincide con la lista configurada en Supabase o si es un origen
 * habitual de esta app (Vercel preview/prod *.vercel.app, localhost).
 */
function resolveAllowOrigin(origin: string | null, configured: string[]): string | null {
  if (!origin) return null;
  if (configured.includes(origin)) return origin;
  if (isTrustedDefaultOrigin(origin)) return origin;
  return null;
}

function corsHeaders(allowOrigin: string | null): Record<string, string> {
  if (!allowOrigin) {
    return { ...baseCorsHeaders };
  }
  return {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': allowOrigin,
  };
}

function json(body: unknown, status = 200, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/**
 * GoTrue Admin API directa; útil cuando `admin.auth.admin.updateUserById` falla en Edge/Deno.
 * @see https://supabase.com/docs/reference/api/auth-admin-update-user-by-id
 */
async function authAdminSetPasswordRest(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  password: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const base = supabaseUrl.replace(/\/$/, '');
  const url = `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
  };
  let lastDetail = '';
  for (const method of ['PUT', 'PATCH'] as const) {
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify({ password }),
    });
    if (res.ok) return { ok: true };
    const txt = await res.text();
    lastDetail = `${method} ${res.status}: ${txt.slice(0, 400)}`;
  }
  return { ok: false, detail: lastDetail };
}

function safeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const PIN_RE = /^\d{4,12}$/;

/** GoTrue `validateUUID` solo acepta hex minúsculas; PostgREST a veces devuelve UUID en mayúsculas y eso lanzaba antes del fetch → 500. */
const UUID_LC_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function authUserIdFromProfileId(id: unknown): string | null {
  const s = String(id).trim().toLowerCase();
  return UUID_LC_RE.test(s) ? s : null;
}

function uuidFromUnknown(data: unknown): string | null {
  if (data == null) return null;
  const s = String(data).trim().toLowerCase();
  return UUID_LC_RE.test(s) ? s : null;
}

/** Resolución por SQL (service_role); no depende del filtro REST con `@`. */
async function authUserIdByEmailRpc(
  admin: ReturnType<typeof createClient>,
  em: string
): Promise<string | null> {
  const { data, error } = await admin.rpc('rpc_resolve_auth_user_id_by_email', {
    p_email: em.trim().toLowerCase(),
  });
  if (error) {
    console.warn('[verify-pos-pin-login] rpc_resolve_auth_user_id_by_email:', error.message);
    return null;
  }
  return uuidFromUnknown(data);
}

/** Id de auth.users vía Admin API (filter estilo PostgREST; el @ del correo suele exigir comillas). */
async function adminAuthUserIdByEmail(
  supabaseUrl: string,
  serviceKey: string,
  em: string
): Promise<string | null> {
  const base = supabaseUrl.replace(/\/$/, '');
  const want = em.trim().toLowerCase();
  const filters = [`email.eq."${want}"`, `email.eq.${want}`];
  for (const filter of filters) {
    const url = `${base}/auth/v1/admin/users?per_page=200&filter=${encodeURIComponent(filter)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.error('[verify-pos-pin-login] admin users:', filter.slice(0, 24), res.status, errTxt);
      continue;
    }
    let raw: Record<string, unknown>;
    try {
      raw = (await res.json()) as Record<string, unknown>;
    } catch {
      console.error('[verify-pos-pin-login] admin users: respuesta no JSON');
      continue;
    }
    const arr =
      (raw.users as { id: string; email?: string }[] | undefined) ??
      ((raw.data as { users?: { id: string; email?: string }[] } | undefined)?.users) ??
      [];
    const match = arr.find((u) => String(u.email ?? '').trim().toLowerCase() === want);
    const id = match?.id;
    if (!id) continue;
    const s = String(id).trim().toLowerCase();
    if (UUID_LC_RE.test(s)) return s;
  }
  return null;
}

/** Último recurso: paginar `/auth/v1/admin/users` (útil si el filtro `email.eq` falla con `@`). */
async function adminAuthUserIdByEmailPaged(
  supabaseUrl: string,
  serviceKey: string,
  em: string
): Promise<string | null> {
  const want = em.trim().toLowerCase();
  const base = supabaseUrl.replace(/\/$/, '');
  for (let page = 1; page <= 20; page++) {
    const url = `${base}/auth/v1/admin/users?page=${page}&per_page=200`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
    if (!res.ok) {
      console.warn('[verify-pos-pin-login] admin users paged:', page, res.status);
      return null;
    }
    let raw: Record<string, unknown>;
    try {
      raw = (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
    const arr =
      (raw.users as { id: string; email?: string }[] | undefined) ??
      ((raw.data as { users?: { id: string; email?: string }[] } | undefined)?.users) ??
      [];
    const match = arr.find((u) => String(u.email ?? '').trim().toLowerCase() === want);
    const id = match?.id;
    if (id) {
      const s = String(id).trim().toLowerCase();
      if (UUID_LC_RE.test(s)) return s;
    }
    if (arr.length < 200) return null;
  }
  return null;
}

/**
 * Resuelve el UUID en Auth para actualizar la contraseña.
 * 1) `profiles.id` → `getUserById` cuando existe en Auth.
 * 2) RPC SQL `rpc_resolve_auth_user_id_by_email` (service_role) por cada correo + alias de dominio.
 * 3) Fallback REST admin users filter.
 * 4) Paginación admin users (si el filtro con `@` no devuelve filas).
 */
async function resolveAuthUserIdForPinSync(
  admin: ReturnType<typeof createClient>,
  opts: {
    supabaseUrl: string;
    serviceKey: string;
    profileId: unknown;
    profileEmail: string;
    requestEmail: string;
  }
): Promise<string | null> {
  const pid = authUserIdFromProfileId(opts.profileId);
  if (pid) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(pid);
      if (!error && data?.user) {
        return pid;
      }
    } catch (e) {
      console.warn('[verify-pos-pin-login] getUserById:', e);
    }
  }

  const emails = new Set<string>();
  for (const base of [opts.profileEmail, opts.requestEmail]) {
    if (base.includes('@')) {
      for (const em of expandServipartzEmailAliases(base)) {
        emails.add(em);
      }
    }
  }
  for (const em of emails) {
    const fromRpc = await authUserIdByEmailRpc(admin, em);
    if (fromRpc) return fromRpc;
    const fromRest = await adminAuthUserIdByEmail(opts.supabaseUrl, opts.serviceKey, em);
    if (fromRest) return fromRest;
    try {
      const fromPaged = await adminAuthUserIdByEmailPaged(opts.supabaseUrl, opts.serviceKey, em);
      if (fromPaged) return fromPaged;
    } catch (e) {
      console.warn('[verify-pos-pin-login] adminAuthUserIdByEmailPaged:', e);
    }
  }

  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const configured = parseAllowedOrigins();
  const allowOrigin = resolveAllowOrigin(origin, configured);
  const ch = corsHeaders(allowOrigin);

  if (req.method === 'OPTIONS') {
    if (allowOrigin == null) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response(null, { status: 204, headers: ch });
  }

  if (allowOrigin == null) {
    return json(errPayload('ORIGIN_NOT_ALLOWED', 'Origin not allowed'), 403, ch);
  }

  if (req.method !== 'POST') {
    return json(errPayload('METHOD_NOT_ALLOWED', 'Method not allowed'), 405, ch);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(errPayload('MISSING_SUPABASE_ENV', 'Missing Supabase env'), 500, ch);
  }

  let body: { email?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(errPayload('INVALID_JSON', 'JSON inválido'), 400, ch);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!email.includes('@') || !PIN_RE.test(pin)) {
    return json(errPayload('INVALID_BODY', 'Solicitud inválida'), 400, ch);
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    type ProfileRow = {
      id: string;
      pos_pin: string | null;
      is_active: boolean;
      email: string | null;
    };

    let rows: ProfileRow[] = [];
    let selErr: { message: string } | null = null;

    const rpcRes = await admin.rpc('rpc_verify_pos_pin_profile_row', { p_email: email });
    if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
      rows = rpcRes.data as ProfileRow[];
    } else {
      if (rpcRes.error) {
        console.warn('[verify-pos-pin-login] rpc_verify_pos_pin_profile_row:', rpcRes.error.message);
      }
      let q = await admin
        .from('profiles')
        .select('id, pos_pin, is_active, email')
        .eq('email', email)
        .limit(2);
      rows = (q.data ?? []) as ProfileRow[];
      selErr = q.error;

      if (!rows.length && !selErr) {
        const second = await admin
          .from('profiles')
          .select('id, pos_pin, is_active, email')
          .ilike('email', email)
          .limit(2);
        rows = (second.data ?? []) as ProfileRow[];
        selErr = second.error;
      }
    }

    if (selErr) {
      console.error('[verify-pos-pin-login] profiles:', selErr.message);
      return json(errPayload('PROFILE_QUERY_FAILED', selErr.message.slice(0, 500)), 500, ch);
    }
    if (!rows?.length) {
      return json(errPayload('NO_PROFILE_FOR_EMAIL', 'No autorizado'), 401, ch);
    }
    if (rows.length > 1) {
      return json(errPayload('DUPLICATE_EMAIL', 'Correo duplicado'), 409, ch);
    }

    const row = rows[0]!;
    const storedPin = row.pos_pin != null ? String(row.pos_pin).trim() : '';
    if (!row.is_active || storedPin.length === 0) {
      return json(errPayload('PROFILE_INACTIVE_OR_NO_PIN', 'No autorizado'), 401, ch);
    }
    if (!safeEqualStr(storedPin, pin)) {
      return json(errPayload('BAD_PIN', 'No autorizado'), 401, ch);
    }

    const profileEmail = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    const newPassword = authPasswordFromPosPin(pin);
    const profileAuthId = authUserIdFromProfileId(row.id);
    let lastDirectUpdateMessage: string | null = null;

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (anonKey) {
      const signInEmails = new Set<string>([email]);
      if (profileEmail.includes('@')) {
        for (const em of expandServipartzEmailAliases(profileEmail)) {
          signInEmails.add(em);
        }
      }
      const probe = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      for (const em of signInEmails) {
        const { error: signErr } = await probe.auth.signInWithPassword({
          email: em,
          password: newPassword,
        });
        if (!signErr) {
          await probe.auth.signOut();
          return json({ ok: true, code: 'ALREADY_SYNCED' }, 200, ch);
        }
      }
    }

    /** Caso habitual Supabase: `profiles.id` = `auth.users.id`. Evita depender de RPC/filtros admin. */
    if (profileAuthId) {
      const { error: directErr } = await admin.auth.admin.updateUserById(profileAuthId, {
        password: newPassword,
      });
      if (!directErr) {
        if (profileEmail.includes('@') && profileEmail !== email) {
          const { error: emailErr } = await admin.auth.admin.updateUserById(profileAuthId, { email: profileEmail });
          if (emailErr) {
            console.warn('[verify-pos-pin-login] no se pudo alinear email en Auth:', emailErr.message);
          }
        }
        return json({ ok: true, code: 'SYNC_OK' }, 200, ch);
      }
      const restDirect = await authAdminSetPasswordRest(supabaseUrl, serviceKey, profileAuthId, newPassword);
      if (restDirect.ok) {
        console.warn('[verify-pos-pin-login] updateUserById falló; REST admin OK:', directErr.message);
        if (profileEmail.includes('@') && profileEmail !== email) {
          const { error: emailErr } = await admin.auth.admin.updateUserById(profileAuthId, { email: profileEmail });
          if (emailErr) {
            console.warn('[verify-pos-pin-login] no se pudo alinear email en Auth:', emailErr.message);
          }
        }
        return json({ ok: true, code: 'SYNC_OK' }, 200, ch);
      }
      lastDirectUpdateMessage = `${directErr.message} | REST: ${restDirect.detail}`;
      console.warn('[verify-pos-pin-login] updateUserById(profile.id) falló, se intenta resolución:', lastDirectUpdateMessage);
    }

    const resolvedId = await resolveAuthUserIdForPinSync(admin, {
      supabaseUrl,
      serviceKey,
      profileId: row.id,
      profileEmail,
      requestEmail: email,
    });
    const authUserId = resolvedId ?? profileAuthId;
    if (!authUserId) {
      console.error('[verify-pos-pin-login] no se pudo resolver usuario Auth para perfil:', row.id);
      return json(errPayload('AUTH_USER_NOT_RESOLVED', 'Usuario Auth no encontrado para este perfil'), 500, ch);
    }
    if (resolvedId == null && profileAuthId != null && authUserId === profileAuthId && lastDirectUpdateMessage) {
      return json(
        { code: 'AUTH_UPDATE_FAILED', error: lastDirectUpdateMessage },
        500,
        ch
      );
    }

    let { error: authErr } = await admin.auth.admin.updateUserById(authUserId, {
      password: newPassword,
    });
    if (authErr) {
      const restSecond = await authAdminSetPasswordRest(supabaseUrl, serviceKey, authUserId, newPassword);
      if (restSecond.ok) {
        console.warn('[verify-pos-pin-login] segundo updateUserById falló; REST admin OK:', authErr.message);
      } else {
        console.error('[verify-pos-pin-login] updateUserById:', authErr.message, '| REST:', restSecond.detail);
        return json(
          errPayload('AUTH_UPDATE_FAILED', `${authErr.message} | ${restSecond.detail}`),
          500,
          ch
        );
      }
    }

    if (profileEmail.includes('@') && profileEmail !== email) {
      const { error: emailErr } = await admin.auth.admin.updateUserById(authUserId, { email: profileEmail });
      if (emailErr) {
        console.warn('[verify-pos-pin-login] no se pudo alinear email en Auth:', emailErr.message);
      }
    }

    return json({ ok: true, code: 'SYNC_OK' }, 200, ch);
  } catch (e) {
    console.error('[verify-pos-pin-login]', e);
    return json(errPayload('INTERNAL', 'Error interno'), 500, ch);
  }
});
