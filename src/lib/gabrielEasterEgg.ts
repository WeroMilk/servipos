import type { User } from '@/types';

const CLICK_WINDOW_MS = 2500;
const REQUIRED_CLICKS = 7;

let clickCount = 0;
let lastClickAt = 0;

function identityParts(user: Pick<User, 'username' | 'name' | 'email'>) {
  const username = (user.username ?? '').trim().toLowerCase();
  const name = (user.name ?? '').trim().toLowerCase();
  const emailLocal = (user.email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  /** Primera palabra del nombre («Alfonso (Cajero)» → alfonso). */
  const nameFirst = name.split(/[\s(]/u)[0]?.trim() ?? '';
  return { username, name, emailLocal, nameFirst };
}

function matchesUserId(
  user: Pick<User, 'username' | 'name' | 'email'> | null | undefined,
  id: string
): boolean {
  if (!user) return false;
  const { username, name, emailLocal, nameFirst } = identityParts(user);
  return username === id || name === id || emailLocal === id || nameFirst === id;
}

/** Misma detección que Header (username / name / local-part email). */
export function isGabrielUser(
  user: Pick<User, 'username' | 'name' | 'email'> | null | undefined
): boolean {
  return matchesUserId(user, 'gabriel');
}

export function isAlfonsoUser(
  user: Pick<User, 'username' | 'name' | 'email'> | null | undefined
): boolean {
  return matchesUserId(user, 'alfonso');
}

/** Quién puede abrir el easter egg Buscaminas (7 clics en el logo). */
export function canAccessBuscaminasEasterEgg(
  user: Pick<User, 'username' | 'name' | 'email'> | null | undefined
): boolean {
  return isGabrielUser(user) || isAlfonsoUser(user);
}

/**
 * Registra un clic al logo. Devuelve `true` cuando llega a 7 clics
 * dentro de la ventana de tiempo (solo llamar si `canAccessBuscaminasEasterEgg`).
 */
export function registerLogoEasterEggClick(): boolean {
  const now = Date.now();
  if (now - lastClickAt > CLICK_WINDOW_MS) {
    clickCount = 0;
  }
  lastClickAt = now;
  clickCount += 1;
  if (clickCount < REQUIRED_CLICKS) return false;
  clickCount = 0;
  lastClickAt = 0;
  return true;
}

export function resetLogoEasterEggClicks(): void {
  clickCount = 0;
  lastClickAt = 0;
}
