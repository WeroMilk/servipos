/** Igual que `src/lib/servipartzAuth.ts` (pares de dominio en login). */
const DOMAIN_ALIAS: Record<string, string> = {
  'servipartz.com': 'serviparts.com',
  'serviparts.com': 'servipartz.com',
};

/** Posibles correos equivalentes (mismo local, dominio alterno). */
export function expandServipartzEmailAliases(email: string): string[] {
  const e = email.trim().toLowerCase();
  if (!e.includes('@')) return [e];
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const out = new Set<string>([e]);
  const alt = DOMAIN_ALIAS[domain];
  if (alt) out.add(`${local}@${alt}`);
  return Array.from(out);
}
