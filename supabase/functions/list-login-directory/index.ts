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

type DirRow = { id: string; name: string | null; email: string | null };

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

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc('rpc_list_login_directory');
    if (error) {
      console.error('[list-login-directory]', error.message);
      return json({ error: 'No se pudo cargar el directorio' }, 500, ch);
    }
    const rows = (Array.isArray(data) ? data : []) as DirRow[];
    const users = rows
      .filter((r) => typeof r.email === 'string' && r.email.length > 0)
      .map((r) => ({
        id: r.id,
        name: (r.name ?? '').trim() || String(r.email).trim(),
        email: String(r.email).trim().toLowerCase(),
      }));
    return json({ users }, 200, ch);
  } catch (e) {
    console.error('[list-login-directory]', e);
    return json({ error: 'Error interno' }, 500, ch);
  }
});
