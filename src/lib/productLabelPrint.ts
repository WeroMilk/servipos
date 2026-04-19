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
    label: 'Brother · 29×60 mm (cinta × largo de corte)',
    hint:
      'Mismo ancho de cinta 29 mm que en el driver; largo 60 mm (no 90). En impresión elija ese tamaño o personalizado 60×29 mm.',
  },
];

const FORMATS: Record<LabelFormatPreset, { pageW: string; pageH: string }> = {
  dk1209: { pageW: '62mm', pageH: '29mm' },
  /**
   * Brother en el driver suele listar «29 × 90 mm» (cinta × largo). Aquí largo 60 mm.
   * En CSS @page: primero ancho del “fajo” horizontal = 60 mm, alto = 29 mm (cinta).
   */
  dk1201: { pageW: '60mm', pageH: '29mm' },
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
 * CODE128: tira 60×29 mm (largo × cinta): barras y texto ajustados a ~29 mm de alto útil.
 */
function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  const len = t.length;

  let barHeight: number;
  let barWidth: number;
  let fontSize: number;

  if (preset === 'dk1201') {
    barHeight = len > 14 ? 72 : 80;
    barWidth = len > 24 ? 2.35 : len > 12 ? 2.55 : 2.75;
    fontSize = len > 18 ? 12 : len > 14 ? 13 : 15;
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
      textMargin: preset === 'dk1201' ? 3 : 6,
      margin: preset === 'dk1201' ? 6 : 12,
    });
    /** Quitar width/height fijos del SVG: si no, el ancho intrínseco (miles de px) ensancha el flex y deja banda blanca. */
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    if (!svg.getAttribute('preserveAspectRatio')) {
      svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    }
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
  const nombre = escapeHtml(p.nombre);
  const precioH = escapeHtml(precio);

  if (preset === 'dk1201') {
    return `
      <section class="label label-dk1201" style="width:60mm;min-width:60mm;max-width:60mm;height:29mm;box-sizing:border-box;">
        <div class="logo-wrap">${logoImg}</div>
        <div class="col-main">
          <div class="text-block">
            <div class="nombre">${nombre}</div>
            <div class="precio">${precioH}</div>
          </div>
          ${bc ? `<div class="bc">${bc}</div>` : ''}
        </div>
      </section>`;
  }

  return `
      <section class="label label-dk1209">
        <div class="logo-wrap">${logoImg}</div>
        <div class="col-main">
          <div class="nombre">${nombre}</div>
          <div class="precio">${precioH}</div>
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
      width: 13mm;
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
      max-width: 13mm;
      max-height: 26mm;
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
    .label-dk1201 .col-main {
      flex: 1 1 0%;
      flex-grow: 1;
      width: 0;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: stretch;
      gap: 0.35mm;
    }
    .label-dk1201 .text-block {
      flex: 0 0 auto;
      width: 100%;
      min-width: 0;
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
      font-size: 8.5pt;
      line-height: 1.08;
      font-weight: 800;
      max-height: 9mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      word-break: break-word;
      overflow-wrap: anywhere;
      hyphens: auto;
    }
    .label-dk1209 .precio { font-size: 11pt; font-weight: 800; }
    .label-dk1201 .text-block .precio {
      margin-top: 0.15mm;
      font-size: 11pt;
      font-weight: 800;
      line-height: 1.05;
    }
    .label-dk1209 .bc {
      width: 100%;
      margin-top: 0.15mm;
      overflow: visible;
      flex-shrink: 0;
    }
    .label-dk1201 .bc {
      flex: 1 1 0;
      min-height: 10mm;
      width: 100%;
      align-self: stretch;
      margin-top: 0;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
    }
    .label-dk1209 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
    }
    .label-dk1201 .bc svg {
      display: block;
      width: 100% !important;
      max-width: 100%;
      height: auto;
      max-height: 100%;
    }
  `;

  const printHint =
    preset === 'dk1201'
      ? `<p class="print-hint-screen" style="margin:0 0 8px;padding:8px 10px;font:12px/1.35 system-ui,sans-serif;color:#e5e5e5;background:#404040;border-radius:6px;max-width:60mm">
  <strong>Impresora Brother (29 mm cinta):</strong> en el cuadro de impresión el tamaño debe ser
  <strong>29 × 60 mm</strong> (largo de corte 60 mm), no 29 × 90 mm. Si no aparece, use
  <strong>tamaño personalizado</strong> / pestaña del driver Brother y defina 60 mm de longitud, o elija la opción más cercana y compruebe <strong>escala 100&nbsp;%</strong>.
</p>`
      : '';

  const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"/>
<title>Etiquetas de producto</title>
<style>
  @page { size: ${f.pageW} ${f.pageH}; margin: 0; }
  * { box-sizing: border-box; }
  html {
    margin: 0;
    padding: 0;
    width: ${f.pageW};
    min-width: ${f.pageW};
    max-width: ${f.pageW};
    overflow-x: hidden;
    background: #525252;
  }
  body {
    margin: 0;
    padding: 0;
    width: ${f.pageW};
    min-width: ${f.pageW};
    max-width: ${f.pageW};
    overflow-x: hidden;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-family: system-ui, "Segoe UI", sans-serif;
    color: #0f172a;
    background: #525252;
  }
  @media print {
    .print-hint-screen { display: none !important; }
    html, body {
      width: ${f.pageW} !important;
      min-width: ${f.pageW} !important;
      max-width: ${f.pageW} !important;
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
    }
  }
  .label {
    width: ${f.pageW};
    min-width: ${f.pageW};
    max-width: ${f.pageW};
    height: ${f.pageH};
    background: #fff;
    page-break-after: always;
    page-break-inside: avoid;
    break-inside: avoid;
    display: flex;
    overflow: hidden;
  }
  .nombre { font-weight: 700; }
  .precio { color: #0f172a; }
  ${cssStrip}
</style></head><body>${printHint}${sections.join('')}</body></html>`;

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
