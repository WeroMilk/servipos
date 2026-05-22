import { BRAND_LOGO_URL } from '@/lib/branding';
import { getDocumentFooterLinesForSucursal } from '@/lib/ticketSucursalFooter';

/** Logo rasterizado (PNG) para tickets térmicos: evita 404 por ruta y fallos si el SVG no cargó a tiempo. */
let cachedBrandLogoDataUrl: string | null = null;
let brandLogoPreloadPromise: Promise<string> | null = null;

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

function rasterizeImageToPngDataUrl(src: string, maxWidthPx: number): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(src);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || maxWidthPx;
      const nh = img.naturalHeight || maxWidthPx;
      const targetW = maxWidthPx;
      const targetH = Math.max(1, Math.round((nh / nw) * targetW));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      const scale = Math.min(targetW / nw, targetH / nh);
      const dw = nw * scale;
      const dh = nh * scale;
      ctx.drawImage(img, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

async function loadBrandLogoDataUrl(): Promise<string> {
  const fallback = getBrandLogoAbsoluteUrl();
  if (typeof window === 'undefined') return fallback;
  try {
    const res = await fetch(fallback, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`logo HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await rasterizeImageToPngDataUrl(objectUrl, 192);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return fallback;
  }
}

/** Precarga el logo en memoria (PNG data URL) para que el primer ticket térmico no salga sin imagen. */
export function preloadBrandLogoForPrint(): Promise<string> {
  if (cachedBrandLogoDataUrl) return Promise.resolve(cachedBrandLogoDataUrl);
  if (!brandLogoPreloadPromise) {
    brandLogoPreloadPromise = loadBrandLogoDataUrl()
      .then((url) => {
        cachedBrandLogoDataUrl = url;
        return url;
      })
      .finally(() => {
        brandLogoPreloadPromise = null;
      });
  }
  return brandLogoPreloadPromise;
}

/** URL embebida (PNG) o absoluta del SVG si falla la precarga. */
export async function resolveBrandLogoDataUrlForPrint(): Promise<string> {
  return preloadBrandLogoForPrint();
}

/** Encabezado marca en rollo 80 mm (logo + título). */
export function buildThermalBrandBlockHtml(heading: string, logoSrc: string): string {
  const src = escapeHtml(logoSrc);
  return `<div class="ticket-brand-block">
    <img class="logo-ticket" src="${src}" alt="SERVIPARTZ" width="96" height="96" decoding="sync" />
    <h1>${escapeHtml(heading)}</h1>
  </div>`;
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
