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
    label: 'Etiqueta larga · 29×65 mm (6,5 cm)',
    hint: 'Etiqueta vertical; largo total 6,5 cm para alinear con el corte del rollo.',
  },
];

const FORMATS: Record<LabelFormatPreset, { pageW: string; pageH: string }> = {
  dk1209: { pageW: '62mm', pageH: '29mm' },
  /** Ancho típico 29 mm; largo 6,5 cm según configuración de impresión. */
  dk1201: { pageW: '29mm', pageH: '65mm' },
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

/**
 * CODE128 para escáner: `height` alto para que, al escalar el SVG al ancho de la etiqueta,
 * las barras queden más gruesas. Márgenes amplios (zona silenciosa). Códigos largos: texto
 * bajo el código más pequeño para no robar alto útil a las barras.
 */
function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  const len = t.length;

  let barWidth: number;
  let barHeight: number;
  let fontSize: number;

  if (preset === 'dk1201') {
    barHeight = len > 16 ? 78 : 86;
    barWidth = len > 20 ? 2.0 : len > 12 ? 2.2 : 2.35;
    fontSize = len > 14 ? 10 : 12;
  } else {
    /** DK-1209: priorizar altura de barras (la escala al ancho las hace más legibles). */
    barHeight = len > 14 ? 80 : 88;
    barWidth = len > 24 ? 2.05 : len > 12 ? 2.25 : 2.45;
    fontSize = len > 18 ? 10 : 12;
  }

  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, t, {
      format: 'CODE128',
      width: barWidth,
      height: barHeight,
      displayValue: true,
      fontSize,
      margin: 12,
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

  const logoImg = `<img class="logo-img" src="${escapeHtml(logoSrc)}" alt="" width="200" height="200" />`;

  if (preset === 'dk1209') {
    return `
      <section class="label label-dk1209">
        <div class="logo-wrap">${logoImg}</div>
        <div class="col-main">
          <div class="nombre">${escapeHtml(p.nombre)}</div>
          <div class="precio">${escapeHtml(precio)}</div>
          ${bc ? `<div class="bc">${bc}</div>` : ''}
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
      align-items: stretch;
      justify-content: flex-start;
      gap: 1.2mm;
      padding: 0.5mm 0.8mm;
    }
    .label-dk1209 .logo-wrap {
      flex-shrink: 0;
      width: 19mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label-dk1209 .logo-img {
      max-width: 19mm;
      max-height: 20mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .label-dk1209 .col-main {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 0.15mm;
    }
    .label-dk1209 .nombre {
      font-size: 9pt;
      line-height: 1.05;
      max-height: 7mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-dk1209 .precio { font-size: 11pt; font-weight: 800; }
    .label-dk1209 .bc {
      width: 100%;
      margin-top: 0.2mm;
      overflow: visible;
      flex-shrink: 0;
    }
    .label-dk1209 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
    }
  `;

  const cssTall = `
    .label-dk1201 {
      flex-direction: column;
      align-items: stretch;
      justify-content: space-between;
      gap: 0;
      padding: 1.2mm 1mm;
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
      max-width: 27mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .label-dk1201 .blk-text {
      text-align: center;
      padding: 0.4mm 0;
    }
    .label-dk1201 .nombre {
      font-size: 13pt;
      line-height: 1.08;
      font-weight: 700;
      word-break: break-word;
    }
    .label-dk1201 .precio { font-size: 17pt; font-weight: 800; margin-top: 0.8mm; }
    .label-dk1201 .blk-code {
      text-align: center;
    }
    .label-dk1201 .bc { margin-top: 0; width: 100%; overflow: visible; }
    .label-dk1201 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
      margin: 0 auto;
    }
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
    page-break-inside: avoid;
    break-inside: avoid;
    display: flex;
    overflow: hidden;
  }
  .nombre { font-weight: 700; }
  .precio { color: #0f172a; }
  ${preset === 'dk1209' ? cssWide : cssTall}
</style></head><body>${sections.join('')}</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    w.focus();
    const closeAfterPrint = () => {
      w.removeEventListener('afterprint', closeAfterPrint);
      w.close();
    };
    w.addEventListener('afterprint', closeAfterPrint);
    w.print();
  };
  return true;
}
