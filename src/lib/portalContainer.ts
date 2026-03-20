/**
 * Host para Radix Portal: debe vivir **dentro** del árbol de React (no como hermano directo
 * exclusivo de `createRoot`), para evitar errores `removeChild` al navegar (React 19 + RR7).
 */
export const RADIX_PORTAL_HOST_ID = 'radix-portal-host';

export function getPortalContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.getElementById(RADIX_PORTAL_HOST_ID) ?? undefined;
}
