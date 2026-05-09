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

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  if (!origin) return false;
  return allowed.includes(origin);
}

function corsHeadersForOrigin(origin: string | null, allowed: string[]): Record<string, string> {
  const allowOrigin = isOriginAllowed(origin, allowed) ? origin! : allowed[0] ?? 'null';
  return {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': allowOrigin,
  };
}

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins();
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

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const posPin = typeof body.posPin === 'string' ? body.posPin.trim() : '';

  if (!userId || !PIN_RE.test(posPin)) {
    return json({ error: 'PIN inválido (4 a 12 dígitos)' }, 400, corsHeaders);
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
