import { getSupabase } from '@/lib/supabaseClient';

/** Sincroniza `profiles.pos_pin` y la contraseña de Supabase Auth (solo administradores). */
export async function adminSetPosPin(userId: string, posPin: string): Promise<void> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error('Falta VITE_SUPABASE_URL');
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesión requerida para cambiar el PIN');

  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/admin-set-pos-pin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, posPin }),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? 'No se pudo actualizar el PIN (¿desplegó admin-set-pos-pin?)');
  }
}
