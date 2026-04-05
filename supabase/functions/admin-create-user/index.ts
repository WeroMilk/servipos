import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: 'Invalid session' }, 401);
  }

  const { data: profile, error: profErr } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !isAdminRole(profile?.role as string | undefined)) {
    return json({ error: 'Solo administradores pueden crear usuarios' }, 403);
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
    return json({ error: 'JSON inválido' }, 400);
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
    return json({ error: 'Faltan email, password o name' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? 'No se pudo crear el usuario' }, 400);
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
    return json({ error: upErr.message }, 400);
  }

  return json({ uid });
});
