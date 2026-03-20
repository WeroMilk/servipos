import { formatMoney } from '@/lib/utils';

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

  const w = window.open('', '_blank', 'noopener,noreferrer,width=360,height=720');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 250);
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

  const w = window.open('', '_blank', 'noopener,noreferrer,width=816,height=1056');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
