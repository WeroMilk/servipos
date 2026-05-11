import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Falta variable de entorno ${String(name)}. Copie .env.example a .env y configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.`
    );
  }
  return value;
}

let client: SupabaseClient | null = null;
/** Cliente sin sesión persistida: REST usa siempre el JWT anónimo (evita 401 si hay token de usuario corrupto/expirado en localStorage). */
let sessionlessClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('VITE_SUPABASE_ANON_KEY'), {
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

/** Para RPC/tablas públicas antes de iniciar sesión; no comparte storage con `getSupabase()`. */
export function getSupabaseSessionless(): SupabaseClient {
  if (!sessionlessClient) {
    sessionlessClient = createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('VITE_SUPABASE_ANON_KEY'), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return sessionlessClient;
}
