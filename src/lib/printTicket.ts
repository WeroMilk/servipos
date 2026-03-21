import { formatMoney } from '@/lib/utils';
import type { Sale } from '@/types';

export type TicketLine = { descripcion: string; cantidad: number; precioUnit: number; total: number };

export type TicketPayload = {
  negocio?: string;
  folio?: string;
  fecha: string;
  cliente?: string;
  lineas: TicketLine[];
  subtotal: number;
  impuestos: number;
  total: number;
  cambio?: number;
  notas?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Abre HTML para imprimir. No usar `noopener` en window.open: en Chrome móvil/desktop
 * devuelve `null` pero igual abre una pestaña vacía (about:blank) y no se puede hacer document.write.
 * Si el popup está bloqueado, se usa un iframe oculto + print().
 */
function openAndPrintHtml(html: string, windowFeatures: string, printDelayMs: number): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  };

  const runPrint = (target: Window) => {
    target.focus();
    setTimeout(() => {
      try {
        target.print();
      } catch {
        /* noop */
      }
    }, printDelayMs);
  };

  // Sin noopener/noreferrer: necesitamos la referencia a la ventana (es contenido propio, mismo origen vía blob).
  const w = window.open(url, '_blank', windowFeatures);
  if (w) {
    const done = () => revoke();
    w.addEventListener('afterprint', done, { once: true });
    w.addEventListener('pagehide', done, { once: true });
    const start = () => runPrint(w);
    if (w.document.readyState === 'complete') start();
    else w.addEventListener('load', start, { once: true });
    setTimeout(revoke, 120_000);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Impresión');
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
  iframe.src = url;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    const cw = iframe.contentWindow;
    if (!cw) {
      document.body.removeChild(iframe);
      revoke();
      return;
    }
    const tearDown = () => {
      if (iframe.parentNode) document.body.removeChild(iframe);
      revoke();
    };
    cw.addEventListener('afterprint', tearDown, { once: true });
    setTimeout(tearDown, 120_000);
    runPrint(cw);
  };
}

/** Ticket 80mm para impresora térmica (contenido en ventana dedicada). */
export function printThermalTicket(payload: TicketPayload): void {
  const negocio = payload.negocio || 'SERVIPARTZ POS';
  const rows = payload.lineas
    .map(
      (l) => `
    <tr>
      <td colspan="2" class="desc">${escapeHtml(l.descripcion)}</td>
    </tr>
    <tr>
      <td>${l.cantidad} x ${formatMoney(l.precioUnit)}</td>
      <td class="right">${formatMoney(l.total)}</td>
    </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Ticket</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 11px; color: #111; width: 72mm; margin: 0 auto; padding: 4px; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 6px; }
  .meta { font-size: 10px; margin-bottom: 8px; border-bottom: 1px dashed #333; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  td.desc { font-weight: 600; padding-top: 6px; }
  td.right { text-align: right; white-space: nowrap; }
  .tot { margin-top: 10px; border-top: 1px dashed #333; padding-top: 6px; font-size: 12px; }
  .tot strong { font-size: 14px; }
</style></head><body>
  <h1>${escapeHtml(negocio)}</h1>
  <div class="meta">
    ${payload.folio ? `<div>Folio: ${escapeHtml(payload.folio)}</div>` : ''}
    <div>${escapeHtml(payload.fecha)}</div>
    ${payload.cliente ? `<div>Cliente: ${escapeHtml(payload.cliente)}</div>` : ''}
  </div>
  <table>${rows}</table>
  <div class="tot">
    <div>Subtotal: ${formatMoney(payload.subtotal)}</div>
    <div>IVA: ${formatMoney(payload.impuestos)}</div>
    <div><strong>TOTAL ${formatMoney(payload.total)}</strong></div>
    ${payload.cambio != null && payload.cambio > 0 ? `<div>Cambio: ${formatMoney(payload.cambio)}</div>` : ''}
  </div>
  ${payload.notas ? `<p style="margin-top:8px;font-size:10px;">${escapeHtml(payload.notas)}</p>` : ''}
  <p style="margin-top:12px;text-align:center;font-size:10px;">¡Gracias por su compra!</p>
</body></html>`;

  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Documento tamaño carta (facturas / cotizaciones) en ventana de impresión. */
export function printLetterDocument(title: string, innerHtml: string): void {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: system-ui, sans-serif; font-size: 11pt; color: #111; line-height: 1.4; }
  h1 { font-size: 16pt; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border-bottom: 1px solid #ccc; padding: 6px 4px; text-align: left; }
  th { font-size: 10pt; color: #444; }
  .right { text-align: right; }
  .tot { margin-top: 16px; font-size: 12pt; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${innerHtml}
</body></html>`;

  openAndPrintHtml(html, 'width=816,height=1056', 300);
}

/** Reimprimir ticket a partir de una venta guardada (POS / historial). */
export function printThermalTicketFromSale(sale: Sale): void {
  const lineas = (sale.productos ?? []).map((item) => {
    const desc =
      item.producto?.nombre?.trim() ||
      `Artículo (${String(item.productId).slice(0, 8)}…)`;
    const disc = Number(item.descuento) || 0;
    const pu = Number(item.precioUnitario) || 0;
    const unit = pu * (1 - disc / 100);
    const qty = Number(item.cantidad) || 0;
    const lineTot =
      item.subtotal != null && Number.isFinite(Number(item.subtotal))
        ? Number(item.subtotal)
        : qty * pu;
    return {
      descripcion: desc,
      cantidad: qty,
      precioUnit: unit,
      total: lineTot,
    };
  });

  const cliente =
    sale.cliente?.nombre?.trim() ||
    (sale.clienteId === 'mostrador' || !sale.clienteId ? 'Mostrador' : sale.clienteId);

  printThermalTicket({
    negocio: 'SERVIPARTZ POS',
    folio: sale.folio,
    fecha: new Date(sale.createdAt).toLocaleString('es-MX'),
    cliente,
    lineas,
    subtotal: Number(sale.subtotal) || 0,
    impuestos: Number(sale.impuestos) || 0,
    total: Number(sale.total) || 0,
    cambio: sale.cambio,
    notas:
      sale.estado === 'cancelada'
        ? 'VENTA CANCELADA'
        : sale.notas
          ? String(sale.notas)
          : undefined,
  });
}
