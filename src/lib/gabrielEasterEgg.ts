import type { User } from '@/types';

const CLICK_WINDOW_MS = 2500;
const REQUIRED_CLICKS = 7;

let clickCount = 0;
let lastClickAt = 0;

/** Misma detección que Header (username / name / local-part email). */
export function isGabrielUser(
  user: Pick<User, 'username' | 'name' | 'email'> | null | undefined
): boolean {
  if (!user) return false;
  const username = (user.username ?? '').trim().toLowerCase();
  const name = (user.name ?? '').trim().toLowerCase();
  const emailLocal = (user.email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  return username === 'gabriel' || name === 'gabriel' || emailLocal === 'gabriel';
}

/**
 * Registra un clic al logo. Devuelve `true` cuando llega a 7 clics
 * dentro de la ventana de tiempo (solo llamar si `isGabrielUser`).
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
