import { formatMoney } from '@/lib/utils';
import { getThermalTicketSucursalFooterLines } from '@/lib/ticketSucursalFooter';
import {
  buildLetterFooterHtml,
  buildLetterHeaderHtml,
  getBrandLogoAbsoluteUrl,
} from '@/lib/documentPrintBranding';
import { getClientById } from '@/db/database';
import { FORMAS_PAGO, type Sale } from '@/types';
import { thermalTicketCancelacionNotas } from '@/lib/saleCancelacion';

async function resolveClienteTicketLabel(sale: Sale): Promise<string> {
  const embedded = sale.cliente?.nombre?.trim();
  if (embedded) return embedded;
  if (sale.clienteId === 'mostrador' || !sale.clienteId) return 'Mostrador';
  try {
    const c = await getClientById(sale.clienteId);
    if (c?.nombre?.trim()) return c.nombre.trim();
  } catch {
    /* catálogo local no disponible o sin el cliente */
  }
  return sale.clienteId;
}

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
  /** Sucursal actual (Firestore `sucursales/{id}`); añade pie de contacto/horario si hay plantilla. */
  sucursalId?: string;
  /** Cajero que registró la venta. */
  cajeroNombre?: string;
  /** Desglose de pagos en el ticket (p. ej. tarjeta con últimos 4 del voucher). */
  resumenPagos?: { label: string; monto: number; ultimos4?: string }[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Abre HTML para imprimir con `about:blank` + `document.write` (no `blob:` URL).
 * Así el pie del diálogo de impresión no muestra una URL `blob:https://…` larga.
 * Sin `noopener` en window.open: en Chrome móvil a veces devuelve `null` pero abre pestaña;
 * si el popup está bloqueado, se usa iframe `about:blank` + write + print().
 */
function openAndPrintHtml(html: string, windowFeatures: string, printDelayMs: number): void {
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

  const printFromHiddenIframe = () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Impresión');
    iframe.style.cssText =
      'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';

    const tearDown = () => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    };

    iframe.onload = () => {
      const cw = iframe.contentWindow;
      if (!cw) {
        tearDown();
        return;
      }
      try {
        cw.document.open();
        cw.document.write(html);
        cw.document.close();
      } catch {
        tearDown();
        return;
      }
      cw.addEventListener('afterprint', tearDown, { once: true });
      setTimeout(tearDown, 120_000);
      runPrint(cw);
    };

    iframe.src = 'about:blank';
    document.body.appendChild(iframe);
  };

  const w = window.open('about:blank', '_blank', windowFeatures);
  if (w) {
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch {
      try {
        w.close();
      } catch {
        /* noop */
      }
      printFromHiddenIframe();
      return;
    }

    const start = () => runPrint(w);
    if (w.document.readyState === 'complete') start();
    else w.addEventListener('load', start, { once: true });
    return;
  }

  printFromHiddenIframe();
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
  .pie-sucursal { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #999; text-align: center; font-size: 9px; line-height: 1.4; color: #222; }
  .pie-sucursal .titulo-suc { font-weight: 700; font-size: 10px; margin-bottom: 4px; }
  .logo-ticket { display: block; margin: 0 auto 6px; max-width: 24mm; height: auto; }
</style></head><body>
  <img class="logo-ticket" src="${escapeHtml(getBrandLogoAbsoluteUrl())}" alt="" width="80" height="80" />
  <h1>${escapeHtml(negocio)}</h1>
  <div class="meta">
    ${payload.folio ? `<div>Folio: ${escapeHtml(payload.folio)}</div>` : ''}
    <div>${escapeHtml(payload.fecha)}</div>
    ${payload.cliente ? `<div>Cliente: ${escapeHtml(payload.cliente)}</div>` : ''}
    ${payload.cajeroNombre ? `<div>Cajero: ${escapeHtml(payload.cajeroNombre)}</div>` : ''}
  </div>
  <table>${rows}</table>
  <div class="tot">
    <div>Subtotal: ${formatMoney(payload.subtotal)}</div>
    <div>IVA: ${formatMoney(payload.impuestos)}</div>
    <div><strong>TOTAL ${formatMoney(payload.total)}</strong></div>
    ${payload.cambio != null && payload.cambio > 0 ? `<div>Cambio: ${formatMoney(payload.cambio)}</div>` : ''}
  </div>
  ${payload.resumenPagos?.length
    ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #333;font-size:10px;line-height:1.45;"><div style="font-weight:600;margin-bottom:3px;">Pagos</div>${payload.resumenPagos
        .map((p) => {
          const tc =
            p.ultimos4 && /^\d{4}$/.test(p.ultimos4)
              ? ` · Tarj. ****${escapeHtml(p.ultimos4)}`
              : '';
          return `<div>${escapeHtml(p.label)}: ${formatMoney(p.monto)}${tc}</div>`;
        })
        .join('')}</div>`
    : ''}
  ${payload.notas ? `<p style="margin-top:8px;font-size:10px;">${escapeHtml(payload.notas)}</p>` : ''}
  ${(() => {
    const lines = getThermalTicketSucursalFooterLines(payload.sucursalId);
    if (!lines?.length) return '';
    const [titulo, ...rest] = lines;
    const body = rest.map((ln) => `<div>${escapeHtml(ln)}</div>`).join('');
    return `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(titulo)}</div>${body}</div>`;
  })()}
  <p style="margin-top:12px;text-align:center;font-size:10px;">¡Gracias por su compra!</p>
</body></html>`;

  openAndPrintHtml(html, 'width=360,height=720', 250);
}

const THERMAL_BASE_STYLES = `@page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 11px; color: #111; width: 72mm; margin: 0 auto; padding: 4px; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 6px; }
  .meta { font-size: 10px; margin-bottom: 8px; border-bottom: 1px dashed #333; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; font-size: 10px; }
  td.right { text-align: right; white-space: nowrap; }
  .tot { margin-top: 8px; border-top: 1px dashed #333; padding-top: 6px; font-size: 11px; }
  .pie-sucursal { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #999; text-align: center; font-size: 9px; line-height: 1.4; color: #222; }
  .pie-sucursal .titulo-suc { font-weight: 700; font-size: 10px; margin-bottom: 4px; }`;

/** Lista de productos con stock bajo para revisión en tienda (80 mm). */
export function printThermalLowStockReport(input: {
  fechaLabel: string;
  sucursalId?: string;
  items: { nombre: string; sku: string; existencia: number; existenciaMinima: number }[];
}): void {
  const rows = input.items
    .map(
      (it) => `<tr><td colspan="2" style="font-weight:600;padding-top:6px;">${escapeHtml(it.nombre.slice(0, 42))}</td></tr>
      <tr><td>SKU ${escapeHtml(it.sku)}</td><td class="right">Ex. ${it.existencia} / mín ${it.existenciaMinima}</td></tr>`
    )
    .join('');
  const lines = getThermalTicketSucursalFooterLines(input.sucursalId);
  const pie =
    lines?.length ?
      `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(lines[0]!)}</div>${lines
        .slice(1)
        .map((ln) => `<div>${escapeHtml(ln)}</div>`)
        .join('')}</div>`
    : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Stock bajo</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>STOCK BAJO</h1>
  <div class="meta">${escapeHtml(input.fechaLabel)}<br/>${input.items.length} artículo(s)</div>
  <table>${rows || '<tr><td>Sin artículos bajo mínimo.</td></tr>'}</table>
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Resumen del día para cierre de caja (80 mm). */
export function printThermalDailySalesReport(input: {
  fechaLabel: string;
  sucursalId?: string;
  ventas: Sale[];
}): void {
  const list = [...input.ventas].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const rows = list
    .map((v) => {
      const st =
        v.estado === 'cancelada' ?
          v.cancelacionMotivo === 'devolucion' ? ' (dev.)'
          : ' (cancel.)'
        : '';
      return `<tr><td>${escapeHtml(v.folio)}${st}</td><td class="right">${formatMoney(Number(v.total) || 0)}</td></tr>`;
    })
    .join('');
  const bruto = list
    .filter((v) => v.estado !== 'cancelada')
    .reduce((s, v) => s + (Number(v.total) || 0), 0);
  const lines = getThermalTicketSucursalFooterLines(input.sucursalId);
  const pie =
    lines?.length ?
      `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(lines[0]!)}</div>${lines
        .slice(1)
        .map((ln) => `<div>${escapeHtml(ln)}</div>`)
        .join('')}</div>`
    : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Reporte ventas</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>REPORTE VENTAS</h1>
  <div class="meta">${escapeHtml(input.fechaLabel)}<br/>${list.length} ticket(s)</div>
  <table>${rows || '<tr><td>Sin ventas.</td></tr>'}</table>
  <div class="tot"><strong>Total día: ${formatMoney(bruto)}</strong><br/><span style="font-size:9px;">Sin canceladas</span></div>
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Documento tamaño carta (facturas / cotizaciones) en ventana de impresión. */
export function printLetterDocument(
  title: string,
  innerHtml: string,
  options?: { sucursalId?: string | null }
): void {
  const head = buildLetterHeaderHtml();
  const foot = buildLetterFooterHtml(options?.sucursalId);
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
${head}
<h1>${escapeHtml(title)}</h1>
${innerHtml}
${foot}
</body></html>`;

  openAndPrintHtml(html, 'width=816,height=1056', 300);
}

/** Reimprimir ticket a partir de una venta guardada (POS / historial). */
export async function printThermalTicketFromSale(sale: Sale): Promise<void> {
  const cliente = await resolveClienteTicketLabel(sale);

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

  const labelFp = (c: string) => FORMAS_PAGO.find((f) => f.clave === c)?.descripcion ?? c;
  const resumenPagos =
    sale.pagos?.map((p) => ({
      label: labelFp(p.formaPago),
      monto: Number(p.monto) || 0,
      ultimos4:
        (p.formaPago === '04' || p.formaPago === '28') && p.referencia?.trim().match(/^\d{4}$/)
          ? p.referencia.trim()
          : undefined,
    })) ?? [];

  printThermalTicket({
    negocio: 'SERVIPARTZ POS',
    sucursalId: sale.sucursalId,
    folio: sale.folio,
    fecha: new Date(sale.createdAt).toLocaleString('es-MX'),
    cliente,
    cajeroNombre: sale.usuarioNombre?.trim() || undefined,
    lineas,
    subtotal: Number(sale.subtotal) || 0,
    impuestos: Number(sale.impuestos) || 0,
    total: Number(sale.total) || 0,
    cambio: sale.cambio,
    resumenPagos: resumenPagos.length > 0 ? resumenPagos : undefined,
    notas:
      sale.estado === 'cancelada'
        ? thermalTicketCancelacionNotas(sale)
        : sale.notas
          ? String(sale.notas)
          : undefined,
  });
}
</think>


<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
Read
