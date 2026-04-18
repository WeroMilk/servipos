import JsBarcode from 'jsbarcode';
import type { Product } from '@/types';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { formatMoney } from '@/lib/utils';

/** Rollos DK habituales para Brother QL (QL-800 y similares). */
export type LabelFormatPreset = 'dk1209' | 'dk1201';

export const LABEL_FORMAT_OPTIONS: { id: LabelFormatPreset; label: string; hint: string }[] = [
  {
    id: 'dk1209',
    label: 'DK-1209 · 62×29 mm',
    hint: 'Etiqueta ancha y baja (dirección / producto corto).',
  },
  {
    id: 'dk1201',
    label: 'DK-1201 · 29×90 mm',
    hint: 'Etiqueta vertical (nombre largo).',
  },
];

const FORMATS: Record<LabelFormatPreset, { pageW: string; pageH: string }> = {
  dk1209: { pageW: '62mm', pageH: '29mm' },
  dk1201: { pageW: '29mm', pageH: '90mm' },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URL absoluta del logo para la ventana de impresión (mismo origen que la app). */
function servipartzLogoUrl(): string {
  try {
    return new URL(BRAND_LOGO_URL, window.location.origin).href;
  } catch {
    return BRAND_LOGO_URL;
  }
}

function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  /** Tamaños ~2× respecto a la versión inicial para aprovechar rollo DK (QL-800). */
  const barHeight = preset === 'dk1201' ? 72 : 44;
  const barWidth = preset === 'dk1201' ? 1.85 : 1.35;
  const fontSize = preset === 'dk1201' ? 18 : 14;
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, t, {
      format: 'CODE128',
      width: barWidth,
      height: barHeight,
      displayValue: true,
      fontSize,
      margin: 0,
    });
    return svg.outerHTML;
  } catch {
    return `<p style="font-size:11pt;margin:0">${escapeHtml(t)}</p>`;
  }
}

function labelBlock(p: Product, preset: LabelFormatPreset, logoSrc: string): string {
  const code = (p.codigoBarras && p.codigoBarras.trim()) || p.sku.trim();
  const bc = barcodeSvgHtml(code, preset);
  const precio = formatMoney(Number(p.precioVenta) || 0);

  const logoImg = `<img class="logo-img" src="${escapeHtml(logoSrc)}" alt="" width="120" height="120" />`;

  if (preset === 'dk1209') {
    return `
      <section class="label label-dk1209">
        <div class="logo-wrap">${logoImg}</div>
        <div class="body">
          <div class="head">
            <div class="nombre">${escapeHtml(p.nombre)}</div>
            <div class="precio">${escapeHtml(precio)}</div>
          </div>
          <div class="tr-foot">
            ${bc ? `<div class="bc">${bc}</div>` : ''}
            <div class="sku">SKU: ${escapeHtml(p.sku)}</div>
          </div>
        </div>
      </section>`;
  }

  return `
    <section class="label label-dk1201">
      <div class="blk blk-logo"><div class="logo-wrap">${logoImg}</div></div>
      <div class="blk blk-text">
        <div class="nombre">${escapeHtml(p.nombre)}</div>
        <div class="precio">${escapeHtml(precio)}</div>
      </div>
      <div class="blk blk-code">
        ${bc ? `<div class="bc">${bc}</div>` : ''}
        <div class="sku">SKU: ${escapeHtml(p.sku)}</div>
      </div>
    </section>`;
}

/**
 * Abre una ventana de impresión con una página por etiqueta, dimensionada al rollo.
 * El navegador enviará el trabajo a la impresora elegida (p. ej. Brother QL-800).
 */
export function printProductLabels(products: Product[], preset: LabelFormatPreset): boolean {
  const f = FORMATS[preset];
  const w = window.open('', '_blank');
  if (!w) return false;

  const logoSrc = servipartzLogoUrl();
  const sections = products.map((p) => labelBlock(p, preset, logoSrc));

  const cssWide = `
    .label-dk1209 {
      flex-direction: row;
      align-items: flex-start;
      justify-content: flex-start;
      gap: 2mm;
      padding: 1mm 1.5mm;
    }
    .label-dk1209 .logo-wrap {
      flex-shrink: 0;
      width: 20mm;
      max-height: 18mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label-dk1209 .logo-img {
      max-width: 20mm;
      max-height: 18mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .label-dk1209 .body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: stretch;
      min-height: 0;
    }
    .label-dk1209 .head {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35mm;
    }
    .label-dk1209 .nombre {
      font-size: 12pt;
      line-height: 1.08;
      max-height: 11mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-dk1209 .precio { font-size: 15pt; font-weight: 800; }
    .label-dk1209 .tr-foot {
      flex-shrink: 0;
      margin-top: auto;
      align-self: flex-end;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.25mm;
      max-width: 100%;
    }
    .label-dk1209 .bc { max-width: 46mm; }
    .label-dk1209 .bc svg { max-width: 100%; height: auto; display: block; }
    .label-dk1209 .sku { font-size: 11pt; font-weight: 600; text-align: right; white-space: nowrap; }
  `;

  const cssTall = `
    .label-dk1201 {
      flex-direction: column;
      align-items: stretch;
      justify-content: space-between;
      gap: 0;
      padding: 2mm 1.2mm;
      min-height: 100%;
    }
    .label-dk1201 .blk { flex-shrink: 0; }
    .label-dk1201 .blk-logo {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .label-dk1201 .logo-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      max-height: 24mm;
    }
    .label-dk1201 .logo-img {
      max-height: 24mm;
      max-width: 26mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .label-dk1201 .blk-text {
      text-align: center;
      padding: 1mm 0;
    }
    .label-dk1201 .nombre {
      font-size: 16pt;
      line-height: 1.12;
      font-weight: 700;
      word-break: break-word;
    }
    .label-dk1201 .precio { font-size: 22pt; font-weight: 800; margin-top: 1.5mm; }
    .label-dk1201 .blk-code {
      text-align: center;
    }
    .label-dk1201 .bc { margin-top: 0; }
    .label-dk1201 .bc svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    .label-dk1201 .sku { font-size: 15pt; font-weight: 600; margin-top: 1.5mm; }
  `;

  const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"/>
<title>Etiquetas de producto</title>
<style>
  @page { size: ${f.pageW} ${f.pageH}; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: system-ui, "Segoe UI", sans-serif; color: #0f172a; }
  .label {
    width: ${f.pageW};
    height: ${f.pageH};
    page-break-after: always;
    display: flex;
  }
  .nombre { font-weight: 700; }
  .precio { color: #0f172a; }
  .sku { color: #1e293b; }
  ${preset === 'dk1209' ? cssWide : cssTall}
</style></head><body>${sections.join('')}</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    w.focus();
    w.print();
  };
  return true;
}
