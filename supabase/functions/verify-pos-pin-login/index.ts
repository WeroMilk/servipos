import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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

function safeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500, corsHeaders);
  }

  let body: { email?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, corsHeaders);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!email.includes('@') || !PIN_RE.test(pin)) {
    return json({ error: 'Solicitud inválida' }, 400, corsHeaders);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: selErr } = await admin
    .from('profiles')
    .select('id, pos_pin, is_active')
    .ilike('email', email)
    .limit(2);

  if (selErr || !rows?.length) {
    return json({ error: 'No autorizado' }, 401, corsHeaders);
  }
  if (rows.length > 1) {
    return json({ error: 'Correo duplicado' }, 409, corsHeaders);
  }

  const row = rows[0]!;
  if (!row.is_active || typeof row.pos_pin !== 'string' || row.pos_pin.length === 0) {
    return json({ error: 'No autorizado' }, 401, corsHeaders);
  }
  if (!safeEqualStr(row.pos_pin, pin)) {
    return json({ error: 'No autorizado' }, 401, corsHeaders);
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(row.id, { password: pin });
  if (authErr) {
    return json({ error: authErr.message }, 500, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
