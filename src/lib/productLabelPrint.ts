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
    label: 'Etiqueta 65×30 mm (largo 6,5 cm × ancho 3 cm)',
    hint: 'Tira horizontal: largo en sentido de avance del rollo 6,5 cm; ancho (altura de cinta) 3 cm.',
  },
];

const FORMATS: Record<LabelFormatPreset, { pageW: string; pageH: string }> = {
  dk1209: { pageW: '62mm', pageH: '29mm' },
  /** Largo 6,5 cm = ancho de página; ancho 3 cm = alto de página (cinta). */
  dk1201: { pageW: '65mm', pageH: '30mm' },
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
 * CODE128 para escáner: DK-1209 prioriza barras; DK-1201 (65×30 mm) acorta barras un poco
 * para dejar el número legible (SKU/código) más grande.
 */
function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  const len = t.length;

  let barHeight: number;
  let barWidth: number;
  let fontSize: number;

  if (preset === 'dk1201') {
    barHeight = len > 14 ? 58 : 64;
    barWidth = len > 24 ? 1.95 : len > 12 ? 2.15 : 2.3;
    /** Texto humano bajo las barras (más grande que en DK-1209). */
    fontSize = len > 18 ? 13 : len > 14 ? 14 : 16;
  } else {
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
      textMargin: preset === 'dk1201' ? 4 : 6,
      margin: preset === 'dk1201' ? 8 : 12,
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

  const rowClass = preset === 'dk1209' ? 'label-dk1209' : 'label-dk1201';
  return `
      <section class="label ${rowClass}">
        <div class="logo-wrap">${logoImg}</div>
        <div class="col-main">
          <div class="nombre">${escapeHtml(p.nombre)}</div>
          <div class="precio">${escapeHtml(precio)}</div>
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

  const cssStrip = `
    .label-dk1209, .label-dk1201 {
      flex-direction: row;
      align-items: stretch;
      justify-content: flex-start;
      gap: 1mm;
      padding: 0.45mm 0.6mm;
    }
    .label-dk1209 .logo-wrap {
      flex-shrink: 0;
      width: 19mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label-dk1201 .logo-wrap {
      flex-shrink: 0;
      width: 14mm;
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
    .label-dk1201 .logo-img {
      max-width: 14mm;
      max-height: 26mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .label-dk1209 .col-main, .label-dk1201 .col-main {
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
    .label-dk1201 .nombre {
      font-size: 10.5pt;
      line-height: 1.18;
      font-weight: 800;
      max-height: 10mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      word-break: break-word;
      hyphens: auto;
    }
    .label-dk1209 .precio { font-size: 11pt; font-weight: 800; }
    .label-dk1201 .precio { font-size: 11pt; font-weight: 800; line-height: 1.1; flex-shrink: 0; }
    .label-dk1209 .bc, .label-dk1201 .bc {
      width: 100%;
      margin-top: 0.15mm;
      overflow: visible;
      flex-shrink: 0;
    }
    .label-dk1209 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
    }
    .label-dk1201 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
      max-height: 13mm;
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
  ${cssStrip}
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
