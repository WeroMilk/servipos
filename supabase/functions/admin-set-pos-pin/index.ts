import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authPasswordFromPosPin } from '../_shared/authPasswordFromPosPin.ts';
import {
  corsHeadersForOrigin,
  parseAllowedOrigins,
  isOriginAllowed,
} from '../_shared/corsAllowedOrigins.ts';

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function isAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const s = role.trim().toLowerCase();
  return s === 'admin' || s === 'administrador';
}

const PIN_RE = /^\d{4,12}$/;

const UUID_LC_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeAuthUserId(id: string): string | null {
  const s = id.trim().toLowerCase();
  return UUID_LC_RE.test(s) ? s : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins(Deno.env.get('ADMIN_CREATE_USER_ALLOWED_ORIGINS'));
  const corsHeaders = corsHeadersForOrigin(origin, allowedOrigins);
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500, corsHeaders);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: 'Invalid session' }, 401, corsHeaders);
  }

  const { data: profile, error: profErr } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !isAdminRole(profile?.role as string | undefined)) {
    return json({ error: 'Solo administradores pueden cambiar el PIN' }, 403, corsHeaders);
  }

  let body: { userId?: string; posPin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, corsHeaders);
  }

  const rawUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const userId = normalizeAuthUserId(rawUserId);
  const posPin = typeof body.posPin === 'string' ? body.posPin.trim() : '';

  if (!userId || !PIN_RE.test(posPin)) {
    return json({ error: 'PIN inválido (4 a 12 dígitos) o usuario inválido' }, 400, corsHeaders);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: authPasswordFromPosPin(posPin),
  });
  if (authErr) {
    return json({ error: authErr.message }, 400, corsHeaders);
  }

  const { error: upErr } = await admin
    .from('profiles')
    .update({
      pos_pin: posPin,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (upErr) {
    return json({ error: upErr.message }, 400, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
