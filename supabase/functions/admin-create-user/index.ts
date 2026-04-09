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

function normalizeRole(r: string): string {
  const s = r.trim().toLowerCase();
  if (s === 'admin' || s === 'administrador') return 'admin';
  if (s === 'gerente') return 'gerente';
  return 'cashier';
}

function isAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const s = role.trim().toLowerCase();
  return s === 'admin' || s === 'administrador';
}

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
    return json({ error: 'Solo administradores pueden crear usuarios' }, 403, corsHeaders);
  }

  let body: {
    email?: string;
    password?: string;
    name?: string;
    username?: string;
    role?: string;
    sucursalId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, corsHeaders);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const username =
    typeof body.username === 'string' && body.username.trim().length > 0
      ? body.username.trim()
      : email.includes('@')
        ? email.split('@')[0]!
        : email;
  const role = typeof body.role === 'string' ? normalizeRole(body.role) : 'cashier';
  const sucursalId =
    typeof body.sucursalId === 'string' && body.sucursalId.length > 0 ? body.sucursalId : null;

  if (!email || !password || !name) {
    return json({ error: 'Faltan email, password o name' }, 400, corsHeaders);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const audit = async (outcome: 'success' | 'error', detail: string, targetEmail?: string) => {
    const now = new Date().toISOString();
    await admin.from('app_events').insert({
      id: crypto.randomUUID().replaceAll('-', ''),
      created_at: now,
      doc: {
        kind: outcome === 'success' ? 'success' : 'warning',
        source: 'edge:admin-create-user',
        title: 'Alta de usuario',
        detail,
        actorUserId: user.id,
        actorEmail: user.email ?? '',
        actorRole: profile?.role ?? '',
        sucursalId: null,
        meta: {
          targetEmail: targetEmail ?? null,
          outcome,
        },
        createdAt: now,
      },
    });
  };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    await audit('error', createErr?.message ?? 'No se pudo crear el usuario', email);
    return json({ error: createErr?.message ?? 'No se pudo crear el usuario' }, 400, corsHeaders);
  }

  const uid = created.user.id;

  const { error: upErr } = await admin.from('profiles').upsert(
    {
      id: uid,
      email,
      username,
      name,
      role,
      is_active: true,
      sucursal_id: sucursalId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (upErr) {
    await admin.auth.admin.deleteUser(uid);
    await audit('error', upErr.message, email);
    return json({ error: upErr.message }, 400, corsHeaders);
  }

  await audit('success', 'Usuario creado', email);
  return json({ uid }, 200, corsHeaders);
});
