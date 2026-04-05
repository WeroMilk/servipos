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

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('VITE_SUPABASE_ANON_KEY'), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return client;
}
