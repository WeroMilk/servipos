import JsBarcode from 'jsbarcode';
import type { Product } from '@/types';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { getProductPrecioPublicoRegular } from '@/lib/productListPricing';
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

/** Factor extra de píxeles al rasterizar el código de barras (mejor nitidez al imprimir / escalar). */
const BARCODE_PRINT_SUPERSAMPLE = 3;

const jsBarcodeBaseOptions = {
  format: 'CODE128' as const,
  lineColor: '#000000',
  background: '#ffffff',
  font: 'Arial, Helvetica, sans-serif',
  fontOptions: 'bold' as const,
  displayValue: true,
};

function barcodeDimensions(code: string, preset: LabelFormatPreset): {
  barHeight: number;
  barWidth: number;
  fontSize: number;
  textMargin: number;
  margin: number;
} {
  const len = code.trim().length;
  if (preset === 'dk1201') {
    /** Códigos largos (EAN, etc.): barras más bajas para que nombre+precio+código quepan centrados. */
    const long = len >= 13;
    return {
      barHeight: long ? (len > 18 ? 70 : 74) : len > 14 ? 88 : 96,
      barWidth: len > 24 ? 2.5 : len > 12 ? 2.7 : 2.9,
      fontSize: long ? (len > 18 ? 10 : 11) : len > 18 ? 11 : len > 14 ? 12 : 14,
      textMargin: 2,
      margin: 4,
    };
  }
  return {
    barHeight: len > 14 ? 80 : 88,
    barWidth: len > 24 ? 2.05 : len > 12 ? 2.25 : 2.45,
    fontSize: len > 18 ? 10 : 12,
    textMargin: 6,
    margin: 12,
  };
}

/**
 * CODE128 raster (PNG de alta resolución): al reducir a la etiqueta las barras se ven más nítidas que escalando SVG.
 */
function barcodeRasterImgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t || typeof document === 'undefined') return '';
  const s = BARCODE_PRINT_SUPERSAMPLE;
  const { barHeight, barWidth, fontSize, textMargin, margin } = barcodeDimensions(t, preset);
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, t, {
      ...jsBarcodeBaseOptions,
      width: barWidth * s,
      height: Math.round(barHeight * s),
      fontSize: Math.round(fontSize * s),
      textMargin: Math.round(textMargin * s),
      margin: Math.round(margin * s),
    });
    const data = canvas.toDataURL('image/png');
    /** Sin escape: `data:` no debe alterarse (p. ej. `&` en base64 raro pero válido). */
    return `<img class="bc-img" src="${data}" alt="" width="${canvas.width}" height="${canvas.height}" decoding="sync" />`;
  } catch {
    return '';
  }
}

/** Respaldo vectorial si el canvas falla. */
function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  const { barHeight, barWidth, fontSize, textMargin, margin } = barcodeDimensions(t, preset);
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, t, {
      ...jsBarcodeBaseOptions,
      width: barWidth,
      height: barHeight,
      fontSize,
      textMargin,
      margin,
    });
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.querySelectorAll('rect, line, path').forEach((el) => {
      el.setAttribute('shape-rendering', 'crispEdges');
    });
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

function barcodePrintHtml(code: string, preset: LabelFormatPreset): string {
  const raster = barcodeRasterImgHtml(code, preset);
  if (raster) return raster;
  return barcodeSvgHtml(code, preset);
}

type ProductLabelPrintExtras = Product & {
  __labelPrecioOverride?: unknown;
  __labelNombreOverride?: unknown;
  /** Solo `false` oculta el código; ausente u otro valor mantiene el comportamiento habitual. */
  __labelShowBarcode?: unknown;
};

function labelBlock(p: Product, preset: LabelFormatPreset, logoSrc: string): string {
  const ext = p as ProductLabelPrintExtras;
  const code = (p.codigoBarras && p.codigoBarras.trim()) || p.sku.trim();
  const showBarcode = ext.__labelShowBarcode !== false;
  const bc = showBarcode ? barcodePrintHtml(code, preset) : '';
  /** Siempre lista Regular al público, con IVA (misma regla que el POS para “precio mostrador”). */
  const precioOverride = ext.__labelPrecioOverride;
  const precioBase =
    typeof precioOverride === 'number' && Number.isFinite(precioOverride) && precioOverride >= 0
      ? precioOverride
      : getProductPrecioPublicoRegular(p);
  const precio = formatMoney(precioBase);

  const nomOverride = ext.__labelNombreOverride;
  const nombreFuente =
    typeof nomOverride === 'string' && nomOverride.trim() ? nomOverride.trim() : p.nombre;

  const logoImg = `<img class="logo-img" src="${escapeHtml(logoSrc)}" alt="" width="640" height="640" decoding="sync" />`;
  const nombre = escapeHtml(nombreFuente);
  const precioH = escapeHtml(precio);

  if (preset === 'dk1201') {
    const hasBc = Boolean(bc);
    const bcShort = hasBc && code.trim().length <= 12;
    const bcLong = hasBc && code.trim().length >= 13;
    const dk1201BcClass = !hasBc ? ' label-dk1201-no-bc' : `${bcShort ? ' label-dk1201-bc-short' : ''}${bcLong ? ' label-dk1201-bc-long' : ''}`;
    return `
      <section class="label label-dk1201${dk1201BcClass}">
        <div class="logo-wrap">${logoImg}</div>
        <div class="col-main">
          <div class="stack">
            <div class="text-block">
              <div class="nombre">${nombre}</div>
              <div class="precio">${precioH}</div>
            </div>
            ${bc ? `<div class="bc">${bc}</div>` : ''}
          </div>
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
 * Con muchas etiquetas, `print()` demasiado pronto puede medir mal el layout o rasterizar
 * antes de que los `data:` del código de barras terminen; una sola suele alcanzar a pintar.
 */
function runWhenPrintWindowReady(win: Window, fn: () => void): void {
  const doc = win.document;
  const kick = () => {
    const imgs = [...doc.images];
    const waitOne = (img: HTMLImageElement) =>
      new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
          return;
        }
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    void Promise.all(imgs.map(waitOne)).then(() => {
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(fn);
      });
    });
  };
  if (doc.readyState === 'complete') {
    kick();
  } else {
    win.addEventListener('load', kick, { once: true });
  }
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
      gap: 0.35mm;
    }
    .label-dk1209 {
      padding: 0.75mm 0.3mm 0.45mm 0.5mm;
    }
    /* Margen interno extra (además del hueco de página en @media print para dk1201). */
    .label-dk1201 {
      padding: 1.1mm 0.65mm 0.45mm 1mm;
    }
    .label-dk1209 .logo-wrap {
      flex-shrink: 0;
      width: 19mm;
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .label-dk1201 .logo-wrap {
      flex-shrink: 0;
      width: 12mm;
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
      object-position: left center;
    }
    .label-dk1201 .logo-img {
      max-width: 12mm;
      max-height: 22mm;
      width: auto;
      height: auto;
      object-fit: contain;
      object-position: center center;
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
    /** Centrado vertical del bloque nombre+precio+código (misma lógica corto/largo y 1 o N hojas). */
    .label-dk1201 .col-main {
      flex: 1 1 0%;
      flex-grow: 1;
      width: 0;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      padding-top: 0.15mm;
      padding-bottom: 0.15mm;
      gap: 0;
    }
    /** Lote: baja un poco el bloque (driver / vista previa multipágina). Una sola: sube un poco. */
    body.labels-print-batch.labels-dk1201 .label-dk1201 .col-main {
      padding-top: 0.42mm;
      padding-bottom: 0.08mm;
    }
    body.labels-print-one.labels-dk1201 .label-dk1201 .col-main {
      padding-top: 0.06mm;
      padding-bottom: 0.38mm;
    }
    .label-dk1201 .stack {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      width: 100%;
      flex: 0 1 auto;
      min-height: 0;
      max-height: 100%;
      overflow: hidden;
      gap: 0.26mm;
    }
    .label-dk1201-bc-short .stack {
      gap: 0.22mm;
    }
    .label-dk1201-bc-long .stack {
      gap: 0.36mm;
    }
    .label-dk1201 .text-block {
      flex: 0 0 auto;
      width: 100%;
      min-width: 0;
      padding-top: 0;
    }
    .label-dk1209 .nombre {
      font-size: 9pt;
      font-weight: 400;
      line-height: 1.05;
      max-height: 7mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-dk1201 .nombre {
      font-size: 6.55pt;
      line-height: 1.05;
      font-weight: 400;
      max-height: 7.2mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      word-break: break-word;
      overflow-wrap: anywhere;
      hyphens: auto;
      margin-top: 0;
      padding-right: 0.15mm;
    }
    .label-dk1209 .precio { font-size: 11pt; font-weight: 800; }
    .label-dk1201 .text-block .precio {
      margin-top: 0.12mm;
      font-size: 10.5pt;
      font-weight: 800;
      line-height: 1.05;
    }
    .label-dk1209 .bc {
      width: 100%;
      margin-top: 0.15mm;
      overflow: visible;
      flex-shrink: 0;
    }
    /**
     * flex: 1 + min-height: 0: el bloque toma el espacio libre bajo el texto y el % max-height
     * del PNG encaja el código completo sin recortar abajo (height:auto + max-height:none lo rompía).
     */
    .label-dk1201 .bc {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      align-self: stretch;
      margin-top: 0;
      padding-bottom: 0.1mm;
      overflow: hidden;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }
    .label-dk1209 .bc .bc-img,
    .label-dk1209 .bc svg {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .label-dk1201 .bc .bc-img,
    .label-dk1201 .bc svg {
      display: block;
      width: 100% !important;
      max-width: 100%;
      height: auto;
      max-height: 100%;
      object-fit: contain;
      object-position: center top;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
  `;

  /** Brother QL suele no imprimir o recortar los primeros mm arriba/izquierda: hueco en página + etiqueta más chica. */
  const dk1201PageInsetCss =
    preset === 'dk1201'
      ? `
  body.labels-dk1201 {
    padding: 3.25mm 0.55mm 0.4mm 3.25mm;
    box-sizing: border-box;
  }
  body.labels-dk1201 .label.label-dk1201 {
    width: calc(${f.pageW} - 3.8mm);
    min-width: 0;
    max-width: calc(${f.pageW} - 3.8mm);
    height: calc(${f.pageH} - 3.65mm);
  }
  @media print {
    body.labels-dk1201 {
      padding: 3.25mm 0.55mm 0.4mm 3.25mm !important;
      box-sizing: border-box !important;
    }
    body.labels-dk1201 .label.label-dk1201 {
      width: calc(${f.pageW} - 3.8mm) !important;
      min-width: 0 !important;
      max-width: calc(${f.pageW} - 3.8mm) !important;
      height: calc(${f.pageH} - 3.65mm) !important;
    }
  }`
      : '';

  const printHint =
    preset === 'dk1201'
      ? `<p class="print-hint-screen" style="margin:0 0 8px;padding:8px 10px;font:12px/1.35 system-ui,sans-serif;color:#e5e5e5;background:#404040;border-radius:6px;max-width:60mm">
  <strong>Brother QL (cinta 29&nbsp;mm):</strong> en impresión elija tamaño de etiqueta
  <strong>60&nbsp;mm de largo</strong> (suele figurar como <strong>29&nbsp;×&nbsp;60&nbsp;mm</strong> o similar), no solo «29&nbsp;mm» ni 29&nbsp;×&nbsp;90&nbsp;mm.
  <strong>Escala 100&nbsp;%</strong> (sin «ajustar a página»). En vista previa verá un margen blanco arriba/izquierda: compensa la zona que la QL suele no imprimir.
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
    font-family: Arial, Helvetica, "Segoe UI", sans-serif;
    color: #000;
    background: #525252;
    text-rendering: geometricPrecision;
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
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
  .label {
    width: ${f.pageW};
    min-width: ${f.pageW};
    max-width: ${f.pageW};
    height: ${f.pageH};
    background: #fff;
    color: #000;
    page-break-after: always;
    page-break-inside: avoid;
    break-inside: avoid;
    display: flex;
    overflow: hidden;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-synthesis: none;
  }
  .nombre { font-weight: 400; color: #000; }
  .precio { color: #000; }
  .logo-img {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    image-rendering: high-quality;
    border-radius: 0.85mm;
  }
  .label .bc svg path,
  .label .bc svg rect,
  .label .bc svg line {
    shape-rendering: crispEdges;
  }
  .label .bc svg text {
    fill: #000;
    text-rendering: geometricPrecision;
  }
  ${cssStrip}
  ${dk1201PageInsetCss}
</style></head><body${
    preset === 'dk1201'
      ? ` class="labels-dk1201 ${products.length === 1 ? 'labels-print-one' : 'labels-print-batch'}"`
      : ''
  }>${printHint}${sections.join('')}</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  runWhenPrintWindowReady(w, () => {
    w.focus();
    const closeAfterPrint = () => {
      w.removeEventListener('afterprint', closeAfterPrint);
      w.close();
    };
    w.addEventListener('afterprint', closeAfterPrint);
    w.print();
  });
  return true;
}
