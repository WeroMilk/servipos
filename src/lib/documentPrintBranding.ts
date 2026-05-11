import { BRAND_LOGO_URL } from '@/lib/branding';
import { getDocumentFooterLinesForSucursal } from '@/lib/ticketSucursalFooter';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * URL absoluta del logo para ventanas de impresión (about:blank + write / iframe).
 * No usar `new URL(BRAND_LOGO_URL, location.href)` con rutas tipo `/ventas/...`: resolvería
 * `/ventas/servipartz-logo-v2.svg` y el archivo en `public/` quedaría en 404.
 */
export function getBrandLogoAbsoluteUrl(): string {
  const file = BRAND_LOGO_URL.replace(/^\.\//, '').replace(/^\//, '');
  try {
    if (typeof window === 'undefined') return BRAND_LOGO_URL;
    if (window.location.protocol === 'file:') {
      return new URL(file, new URL('./', window.location.href)).href;
    }
    const viteBase = import.meta.env.BASE_URL ?? '/';
    const origin = window.location.origin;
    if (viteBase === './' || viteBase === '.' || viteBase === '/') {
      return new URL(file, `${origin}/`).href;
    }
    const base = viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
    return new URL(file, `${origin}${base}`).href;
  } catch {
    return BRAND_LOGO_URL;
  }
}

export function buildLetterHeaderHtml(): string {
  const src = escapeHtml(getBrandLogoAbsoluteUrl());
  return `
  <div class="doc-brand-head">
    <img src="${src}" alt="SERVIPARTZ" width="60" height="60" />
    <div class="doc-brand-title">SERVIPARTZ</div>
  </div>`;
}

export function buildLetterFooterHtml(sucursalId?: string | null): string {
  const lines = getDocumentFooterLinesForSucursal(sucursalId);
  const body = lines.map((ln) => `<div>${escapeHtml(ln)}</div>`).join('');
  return `
  <div class="doc-brand-foot">
    ${body}
  </div>`;
}
