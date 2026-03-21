import { BRAND_LOGO_URL } from '@/lib/branding';
import { getDocumentFooterLinesForSucursal } from '@/lib/ticketSucursalFooter';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URL absoluta del logo para ventanas de impresión (blob / nueva pestaña). */
export function getBrandLogoAbsoluteUrl(): string {
  try {
    return new URL(BRAND_LOGO_URL, window.location.href).href;
  } catch {
    return BRAND_LOGO_URL;
  }
}

export function buildLetterHeaderHtml(): string {
  const src = escapeHtml(getBrandLogoAbsoluteUrl());
  return `
  <div class="doc-brand-head" style="text-align:center;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;">
    <img src="${src}" alt="SERVIPARTZ" width="60" height="60" style="max-width:min(70px,22vw);height:auto;object-fit:contain;display:inline-block;" />
    <div style="margin-top:8px;font-size:15pt;font-weight:700;letter-spacing:0.02em;">SERVIPARTZ</div>
  </div>`;
}

export function buildLetterFooterHtml(sucursalId?: string | null): string {
  const lines = getDocumentFooterLinesForSucursal(sucursalId);
  const body = lines.map((ln) => `<div>${escapeHtml(ln)}</div>`).join('');
  return `
  <div class="doc-brand-foot" style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9pt;line-height:1.45;color:#334155;text-align:center;">
    ${body}
  </div>`;
}
