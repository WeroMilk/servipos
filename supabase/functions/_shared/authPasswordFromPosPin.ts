const POS_PIN_RE = /^\d{4,12}$/;

/**
 * Contraseña en Auth a partir del PIN POS (GoTrue suele exigir ≥6 caracteres).
 * Si el proyecto tiene política de contraseña (minúscula + mayúscula + dígito), debe cumplirla.
 * Debe coincidir con `src/lib/authPasswordFromPosPin.ts`.
 */
export function authPasswordFromPosPin(pin: string): string {
  const p = pin.trim();
  if (!POS_PIN_RE.test(p)) return p;
  return `Pos-${p}-Pin`;
}
