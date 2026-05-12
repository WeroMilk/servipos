import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name];
  if (typeof raw !== 'string') {
    throw new Error(
      `Falta variable de entorno ${String(name)}. Copie .env.example a .env y configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.`
    );
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error(
      `Variable de entorno ${String(name)} está vacía (solo espacios). Revise Vercel → Settings → Environment Variables y vuelva a desplegar.`
    );
  }
  return value;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = requireEnv('VITE_SUPABASE_URL');
    const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');
    client = createClient(url, anonKey, {
      // Refuerzo: si por algún motivo el SDK no adjunta `apikey` en Auth, GoTrue responde
      // "No API key found in request" (400). Los headers globales se fusionan en cada fetch.
      global: {
        headers: {
          apikey: anonKey,
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return client;
}
