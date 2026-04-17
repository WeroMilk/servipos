import JsBarcode from 'jsbarcode';
import type { Product } from '@/types';

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

function barcodeSvgHtml(code: string, preset: LabelFormatPreset): string {
  const t = code.trim();
  if (!t) return '';
  const barHeight = preset === 'dk1201' ? 40 : 28;
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, t, {
      format: 'CODE128',
      width: 1.05,
      height: barHeight,
      displayValue: true,
      fontSize: 10,
      margin: 0,
    });
    return svg.outerHTML;
  } catch {
    return `<p style="font-size:7.5pt;margin:0">${escapeHtml(t)}</p>`;
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

  const sections: string[] = [];
  for (const p of products) {
    const code = (p.codigoBarras && p.codigoBarras.trim()) || p.sku.trim();
    const bc = barcodeSvgHtml(code, preset);
    sections.push(`
      <section class="label">
        <div class="nombre">${escapeHtml(p.nombre)}</div>
        <div class="sku">SKU: ${escapeHtml(p.sku)}</div>
        ${bc ? `<div class="bc">${bc}</div>` : ''}
      </section>
    `);
  }

  const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"/>
<title>Etiquetas de producto</title>
<style>
  @page { size: ${f.pageW} ${f.pageH}; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: system-ui, "Segoe UI", sans-serif; }
  .label {
    width: ${f.pageW};
    height: ${f.pageH};
    page-break-after: always;
    padding: 1.5mm;
    display: flex;
    flex-direction: column;
    ${preset === 'dk1201' ? 'justify-content: flex-start;' : 'justify-content: center;'}
  }
  .nombre { font-weight: 700; font-size: 8.5pt; line-height: 1.15; word-break: break-word; overflow: hidden; }
  .sku { font-size: 7.5pt; color: #1a1a1a; margin-top: 0.6mm; }
  .bc { margin-top: 1mm; max-width: 100%; }
  .bc svg { max-width: 100%; height: auto; display: block; }
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
