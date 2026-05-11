const POS_PIN_RE = /^\d{4,12}$/;

export function looksLikePosPin(pin: string): boolean {
  return POS_PIN_RE.test(pin.trim());
}

export type PosPinSyncResult =
  | { ok: true }
  | { ok: false; status: number; error?: string };

/**
 * Si `profiles.pos_pin` coincide con el PIN pero Auth tenía otra contraseña,
 * alinea la contraseña vía Edge Function `verify-pos-pin-login`.
 */
export async function syncAuthPasswordFromPosPin(email: string, pin: string): Promise<PosPinSyncResult> {
  if (!looksLikePosPin(pin)) return { ok: false, status: 0 };
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anonKey) return { ok: false, status: 0 };

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
    let parsed: { ok?: boolean; error?: string } = {};
    try {
      parsed = (await res.json()) as { ok?: boolean; error?: string };
    } catch {
      /* cuerpo no JSON (p. ej. proxy HTML) */
    }
    if (res.ok && parsed.ok === true) return { ok: true };
    const err = typeof parsed.error === 'string' ? parsed.error : undefined;
    return { ok: false, status: res.status, error: err };
  } catch {
    return { ok: false, status: 0 };
  }
}
