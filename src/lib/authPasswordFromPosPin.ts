const POS_PIN_RE = /^\d{4,12}$/;

/**
 * Contraseña que se guarda en Supabase Auth a partir del PIN numérico de la UI.
 * GoTrue suele rechazar contraseñas de menos de 6 caracteres; el PIN visible sigue siendo solo dígitos.
 *
 * Debe coincidir con `supabase/functions/_shared/authPasswordFromPosPin.ts`.
 */
export function authPasswordFromPosPin(pin: string): string {
  const p = pin.trim();
  if (!POS_PIN_RE.test(p)) return p;
  return `pos-${p}-pin`;
}
