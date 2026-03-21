const DEFAULT_DOMAIN = 'servipartz.com';

/** Prefijos de correo disponibles en la pantalla de login (se concatena con @{getServipartzEmailDomain()}). */
export const SERVIPARTZ_LOGIN_USERNAMES = ['gabriel', 'zavala'] as const;

export function getServipartzEmailDomain(): string {
  const d = import.meta.env.VITE_SERVIPARTZ_EMAIL_DOMAIN?.trim();
  return d && d.length > 0 ? d.toLowerCase() : DEFAULT_DOMAIN;
}

/**
 * Acepta "zavala", "ZAVALA" o "zavala@servipartz.com" y devuelve el correo completo.
 */
export function normalizeServipartzEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const domain = getServipartzEmailDomain();
  return `${trimmed}@${domain}`;
}
