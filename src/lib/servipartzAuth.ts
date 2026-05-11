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

/** Dominios equivalentes en producción (evita login roto si Auth y `profiles` difieren en una letra). */
const DOMAIN_ALIAS_PAIR: Record<string, string> = {
  'servipartz.com': 'serviparts.com',
  'serviparts.com': 'servipartz.com',
};

/**
 * Correos a probar en login (`signInWithPassword` + flujo PIN), en orden.
 * Incluye par servipartz.com ↔ serviparts.com para el mismo usuario local.
 */
export function buildLoginEmailCandidates(raw: string): string[] {
  const primary = normalizeServipartzEmail(raw);
  if (!primary) return [];
  const at = primary.lastIndexOf('@');
  if (at === -1) return [primary];
  const local = primary.slice(0, at);
  const domain = primary.slice(at + 1);
  const alt = DOMAIN_ALIAS_PAIR[domain];
  const set = new Set<string>([primary]);
  if (alt) set.add(`${local}@${alt}`);
  return Array.from(set);
}
