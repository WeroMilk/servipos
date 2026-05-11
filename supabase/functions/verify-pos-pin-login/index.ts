import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authPasswordFromPosPin } from '../_shared/authPasswordFromPosPin.ts';

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
    return json({ error: 'Origin not allowed' }, 403, ch);
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, ch);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500, ch);
  }

  let body: { email?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, ch);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!email.includes('@') || !PIN_RE.test(pin)) {
    return json({ error: 'Solicitud inválida' }, 400, ch);
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error: selErr } = await admin
      .from('profiles')
      .select('id, pos_pin, is_active, email')
      .ilike('email', email)
      .limit(2);

    if (selErr || !rows?.length) {
      return json({ error: 'No autorizado' }, 401, ch);
    }
    if (rows.length > 1) {
      return json({ error: 'Correo duplicado' }, 409, ch);
    }

    const row = rows[0]!;
    if (!row.is_active || typeof row.pos_pin !== 'string' || row.pos_pin.length === 0) {
      return json({ error: 'No autorizado' }, 401, ch);
    }
    if (!safeEqualStr(row.pos_pin, pin)) {
      return json({ error: 'No autorizado' }, 401, ch);
    }

    const authUserId = authUserIdFromProfileId(row.id);
    if (!authUserId) {
      console.error('[verify-pos-pin-login] id de perfil no es UUID válido:', row.id);
      return json({ error: 'Perfil inconsistente' }, 500, ch);
    }

    const profileEmail = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';

    const newPassword = authPasswordFromPosPin(pin);
    const { data: userData, error: getUserErr } = await admin.auth.admin.getUserById(authUserId);
    if (getUserErr) {
      console.error('[verify-pos-pin-login] getUserById:', getUserErr.message);
      return json({ error: getUserErr.message }, 500, ch);
    }

    const curEmail = userData.user?.email?.trim().toLowerCase() ?? '';
    const alignEmail = profileEmail.includes('@') && curEmail !== profileEmail;

    let patch: { password: string; email?: string } = alignEmail
      ? { password: newPassword, email: profileEmail }
      : { password: newPassword };

    let { error: authErr } = await admin.auth.admin.updateUserById(authUserId, patch);
    if (authErr && patch.email) {
      console.warn('[verify-pos-pin-login] alinear email falló, solo contraseña:', authErr.message);
      ({ error: authErr } = await admin.auth.admin.updateUserById(authUserId, { password: newPassword }));
    }
    if (authErr) {
      return json({ error: authErr.message }, 500, ch);
    }

    return json({ ok: true }, 200, ch);
  } catch (e) {
    console.error('[verify-pos-pin-login]', e);
    return json({ error: 'Error interno' }, 500, ch);
  }
});
