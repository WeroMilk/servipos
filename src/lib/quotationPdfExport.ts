import type { Quotation } from '@/types';
import { formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { buildLetterDocumentHtml } from '@/lib/printTicket';
import { exportLetterHtmlToPdf } from '@/lib/letterHtmlPdfExport';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Cuerpo HTML interno de la cotización en formato carta (misma plantilla que imprimir). */
export function buildQuotationLetterInnerHtml(q: Quotation): string {
  const rows = q.productos
    .map(
      (it) =>
        `<tr><td>${esc(it.producto?.nombre?.trim() || 'Producto')}</td><td class="right">${it.cantidad}</td><td class="right">${formatMoney(it.precioUnitario)}</td><td class="right">${formatMoney(it.total)}</td></tr>`
    )
    .join('');
  return `
    <p><strong>Cliente:</strong> ${esc(q.cliente?.nombre ?? 'Mostrador')}</p>
    <p><strong>Fecha:</strong> ${esc(formatInAppTimezone(q.createdAt, { dateStyle: 'medium', timeStyle: 'short' }))}</p>
    <p><strong>Cajero:</strong> ${esc(q.usuarioNombre?.trim() || '—')}</p>
    <p><strong>Vigencia:</strong> ${esc(formatInAppTimezone(q.fechaVigencia, { dateStyle: 'medium' }))}</p>
    <table>
      <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">P. unit.</th><th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="tot">
      <p>Subtotal: ${formatMoney(q.subtotal)}</p>
      <p>Impuestos: ${formatMoney(q.impuestos)}</p>
      <p><strong>Total: ${formatMoney(q.total)}</strong></p>
    </div>
  `;
}

export async function exportQuotationLetterToPdf(
  q: Quotation,
  fallbackSucursalId?: string | null
): Promise<void> {
  const title = `Cotización ${q.folio}`;
  const html = buildLetterDocumentHtml(title, buildQuotationLetterInnerHtml(q), {
    sucursalId: q.sucursalId ?? fallbackSucursalId ?? null,
  });
  const safeFolio = String(q.folio ?? 'cotizacion').replace(/[^\w.-]+/g, '_');
  await exportLetterHtmlToPdf(html, `Cotizacion_${safeFolio}`);
}
