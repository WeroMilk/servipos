/**
 * Host para Radix Portal: nodo **estático** en `index.html` (hermano de `#root`, no gestionado
 * por el reconciler). Así no desaparece al re-render / StrictMode y se evita `removeChild`
 * (NotFoundError) al cerrar overlays al navegar (React 19 + React Router + Radix).
 */
export const RADIX_PORTAL_HOST_ID = 'radix-portal-host';

export function getPortalContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.getElementById(RADIX_PORTAL_HOST_ID) ?? undefined;
}
