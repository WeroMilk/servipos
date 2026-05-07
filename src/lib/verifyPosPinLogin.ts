const POS_PIN_RE = /^\d{4,12}$/;

export function looksLikePosPin(pin: string): boolean {
  return POS_PIN_RE.test(pin.trim());
}

/**
 * Si `profiles.pos_pin` coincide con el PIN pero Auth tenía otra contraseña,
 * alinea la contraseña de Supabase Auth y devuelve true (el cliente puede reintentar signIn).
 */
export async function syncAuthPasswordFromPosPin(email: string, pin: string): Promise<boolean> {
  if (!looksLikePosPin(pin)) return false;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anonKey) return false;

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/verify-pos-pin-login`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        pin: pin.trim(),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}
