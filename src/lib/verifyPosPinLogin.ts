const POS_PIN_RE = /^\d{4,12}$/;

export function looksLikePosPin(pin: string): boolean {
  return POS_PIN_RE.test(pin.trim());
}

export type PosPinSyncResult =
  | { ok: true }
  | { ok: false; status: number; error?: string; code?: string };

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
    let parsed: { ok?: boolean; error?: string; code?: string } = {};
    try {
      parsed = (await res.json()) as { ok?: boolean; error?: string; code?: string };
    } catch {
      /* cuerpo no JSON (p. ej. proxy HTML) */
    }
    const err = typeof parsed.error === 'string' ? parsed.error : undefined;
    const code = typeof parsed.code === 'string' ? parsed.code : undefined;
    if (res.ok && parsed.ok === true) return { ok: true };
    /**
     * La Edge puede responder HTTP 200 + `{ ok: false }` en denegaciones esperadas
     * (PIN incorrecto, sin perfil, etc.) para no llenar la consola del navegador con
     * "Failed to load resource 401". Mapeamos a status lógico para el cliente.
     */
    const status =
      res.ok && parsed.ok === false
        ? code === 'ORIGIN_NOT_ALLOWED'
          ? 403
          : code === 'DUPLICATE_EMAIL'
            ? 409
            : code === 'MISSING_SUPABASE_ENV' ||
                code === 'PROFILE_QUERY_FAILED' ||
                code === 'AUTH_USER_NOT_RESOLVED' ||
                code === 'AUTH_UPDATE_FAILED' ||
                code === 'INTERNAL'
              ? 500
              : 401
        : res.status;
    return { ok: false, status, error: err, code };
  } catch {
    return { ok: false, status: 0 };
  }
}
