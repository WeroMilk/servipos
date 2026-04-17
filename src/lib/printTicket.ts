import type { NominaPruebaPrintInput } from '@/lib/cfdiRepresentacionImpresa';
import { formatMoney } from '@/lib/utils';
import { getThermalTicketSucursalFooterLines } from '@/lib/ticketSucursalFooter';
import {
  buildLetterFooterHtml,
  buildLetterHeaderHtml,
  getBrandLogoAbsoluteUrl,
} from '@/lib/documentPrintBranding';
import { getClientById } from '@/db/database';
import {
  FORMAS_PAGO,
  type CajaAporteEfectivo,
  type CajaRetiroEfectivo,
  type Quotation,
  type Sale,
} from '@/types';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { thermalTicketCancelacionNotas } from '@/lib/saleCancelacion';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { getProductCatalogSnapshot } from '@/lib/firestore/productsFirestore';
import { labelFormaPagoCaja, resumenGruposMedioPagoCierre, totalesPorFormaPago } from '@/lib/cajaResumen';
import { openCfdiLetterPrint } from '@/lib/openLetterPrint';
import JsBarcode from 'jsbarcode';

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
  /** Saldo que quedó a cargo del cliente en esta venta (PPD / pago parcial). */
  adeudoPendiente?: number;
  notas?: string;
  /** Sucursal actual (Firestore `sucursales/{id}`); añade pie de contacto/horario si hay plantilla. */
  sucursalId?: string;
  /** Cajero que registró la venta. */
  cajeroNombre?: string;
  /** Desglose de pagos en el ticket (p. ej. tarjeta con últimos 4 del voucher). */
  resumenPagos?: { label: string; monto: number; ultimos4?: string }[];
  /** Texto final bajo el pie de sucursal (p. ej. cotización: sin valor fiscal). */
  pieMensaje?: string;
  /**
   * Ticket de venta cobrada: leyendas de garantía/cambios y código de barras del folio
   * (escaneable en POS para devolución o referencia al facturar).
   */
  incluirPiePoliticasRefacciones?: boolean;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Solo `printThermalTicket` (venta, cotización impresa como ticket, devolución):
 * Tipografía más compacta y proporcionada al 80 mm; columna centrada sin corrimiento (evita corte a la izquierda).
 * Márgenes de página equilibrados; pie de sucursal un poco menor que el cuerpo.
 */
const THERMAL_TICKET_VENTA_STYLES = `
  @page { size: 80mm auto; margin: 5.5mm 5.5mm 6mm 5.5mm; }
  body.ticket-venta {
    position: static;
    width: 64mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 8px 4px 12px;
    font-size: 15px;
    line-height: 1.35;
  }
  body.ticket-venta h1,
  body.ticket-venta .ticket-brand-block h1 {
    font-size: 17px !important;
    margin: 0 0 6px !important;
    line-height: 1.2 !important;
  }
  body.ticket-venta .ticket-brand-block { margin-bottom: 8px; }
  body.ticket-venta .ticket-brand-block .logo-ticket {
    display: block !important;
    max-width: 28mm;
    width: 28mm;
    height: auto;
    object-fit: contain;
    margin: 0 auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.ticket-venta .meta { font-size: 12px; margin-bottom: 8px; padding-bottom: 6px; line-height: 1.35; }
  body.ticket-venta table { table-layout: fixed; width: 100%; }
  body.ticket-venta td { font-size: 13px; padding: 2px 0; overflow-wrap: anywhere; word-break: break-word; }
  body.ticket-venta td.desc { font-size: 13px; padding-top: 6px; }
  body.ticket-venta td.right { white-space: normal; }
  body.ticket-venta .tot { font-size: 14px; margin-top: 8px; padding-top: 8px; line-height: 1.35; }
  body.ticket-venta .tot strong { font-size: 19px; }
  body.ticket-venta .ticket-pagos { font-size: 13px !important; line-height: 1.4; margin-top: 8px; padding-top: 8px; }
  body.ticket-venta .ticket-pagos .tit { margin-bottom: 4px; }
  body.ticket-venta .meta,
  body.ticket-venta .tot,
  body.ticket-venta .ticket-pagos,
  body.ticket-venta .pie-sucursal,
  body.ticket-venta .ticket-politicas,
  body.ticket-venta .ticket-notas {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-venta .pie-sucursal { font-size: 9px; line-height: 1.4; margin-top: 10px; padding-top: 8px; }
  body.ticket-venta .pie-sucursal .titulo-suc { font-size: 11px; margin-bottom: 3px; }
  body.ticket-venta .ticket-notas { font-size: 11px; line-height: 1.4; margin-top: 8px; }
  body.ticket-venta .ticket-politicas { font-size: 10px; line-height: 1.4; margin-top: 8px; padding-top: 8px; }
  body.ticket-venta .ticket-politicas div + div { margin-top: 3px; }
  body.ticket-venta .ticket-barcode-wrap { margin-top: 10px; }
  body.ticket-venta .ticket-barcode-wrap img { width: 220px !important; max-width: 100% !important; height: auto; }
  body.ticket-venta .ticket-gracias { font-size: 12px; line-height: 1.35; margin-top: 10px; font-weight: 600; }
`;

/** CSS compartido: ticket de venta 80 mm e informes térmicos (tipografía grande para leer en papel). */
const THERMAL_BASE_STYLES = `@page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 22px; color: #111; width: 72mm; margin: 0 auto; padding: 4px; }
  h1 { font-size: 28px; text-align: center; margin: 0 0 10px; line-height: 1.15; }
  /* Encabezado marca: logo arriba, título debajo; ambos centrados en el ancho del ticket */
  .ticket-brand-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    margin: 0 0 12px 0;
    padding: 0;
    box-sizing: border-box;
  }
  .ticket-brand-block h1 {
    margin: 8px 0 0 0 !important;
    width: 100%;
    text-align: center !important;
    line-height: 1.15;
  }
  .ticket-brand-block .logo-ticket {
    display: block;
    margin: 0 auto;
    max-width: 30mm;
    width: auto;
    height: auto;
  }
  .meta { font-size: 18px; margin-bottom: 10px; border-bottom: 1px dashed #333; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; vertical-align: top; font-size: 20px; }
  td.desc { font-weight: 600; padding-top: 10px; font-size: 21px; }
  td.right { text-align: right; white-space: nowrap; }
  .tot { margin-top: 12px; border-top: 1px dashed #333; padding-top: 10px; font-size: 22px; }
  .tot strong { font-size: 30px; }
  .pie-sucursal { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #999; text-align: center; font-size: 21px; line-height: 1.55; font-weight: 500; color: #111; width: 100%; }
  .pie-sucursal .titulo-suc { font-weight: 800; font-size: 26px; margin-bottom: 8px; text-align: center; letter-spacing: 0.02em; }
  .pie-sucursal > div { text-align: center; }
  .ticket-politicas { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #666; font-size: 17px; line-height: 1.45; text-align: center; color: #111; font-weight: 600; }
  .ticket-politicas div + div { margin-top: 6px; }
  .ticket-barcode-wrap { margin-top: 14px; text-align: center; }
  .ticket-barcode-wrap img { display: block; margin: 0 auto; max-width: 100%; height: auto; image-rendering: pixelated; }`;

const TICKET_POLITICAS_REFACCIONES_LINES = [
  'En partes electricas, no hay garantia',
  'Cambios dentro de 48 hrs, excepto partes electricas',
] as const;

/** Code128 del folio para escáner (mismo texto que se teclea en devolución). */
function folioBarcodeDataUrl(folio: string): string | null {
  const t = folio.trim();
  if (!t || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, t, {
      format: 'CODE128',
      width: 1.85,
      height: 56,
      displayValue: true,
      fontSize: 15,
      margin: 6,
      background: '#ffffff',
      lineColor: '#000000',
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Cierra la ventana/pestaña de impresión tras el diálogo (algunos navegadores no disparan
 * `afterprint` en el objeto `Window` del padre; el script corre en el documento impreso).
 */
function injectPrintCloseScript(html: string): string {
  const script =
    '<script>document.addEventListener("afterprint",function(){try{window.close()}catch(e){}},{once:true});</script>';
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, (m) => `${script}${m}`);
  return `${html}${script}`;
}

/**
 * Abre HTML para imprimir con `about:blank` + `document.write` (no `blob:` URL).
 * Así el pie del diálogo de impresión no muestra una URL `blob:https://…` larga.
 * Sin `noopener` en window.open: en Chrome móvil a veces devuelve `null` pero abre pestaña;
 * si el popup está bloqueado, se usa iframe `about:blank` + write + print().
 */
function openAndPrintHtml(html: string, windowFeatures: string, printDelayMs: number): void {
  const htmlWithClose = injectPrintCloseScript(html);

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
        cw.document.write(htmlWithClose);
        cw.document.close();
      } catch {
        tearDown();
        return;
      }
      cw.addEventListener('afterprint', tearDown, { once: true });
      try {
        cw.document.addEventListener('afterprint', tearDown, { once: true });
      } catch {
        /* noop */
      }
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
      w.document.write(htmlWithClose);
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

    const safeClosePrintWindow = () => {
      try {
        if (w && !w.closed) w.close();
      } catch {
        /* noop */
      }
    };

    /** Tras cerrar el diálogo de impresión, cierra la ventana del ticket (navegadores sin `afterprint`: respaldo). */
    let closeFallback = window.setTimeout(safeClosePrintWindow, 45_000);
    w.addEventListener(
      'afterprint',
      () => {
        window.clearTimeout(closeFallback);
        safeClosePrintWindow();
      },
      { once: true }
    );
    try {
      w.document.addEventListener(
        'afterprint',
        () => {
          window.clearTimeout(closeFallback);
          safeClosePrintWindow();
        },
        { once: true }
      );
    } catch {
      /* noop */
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
  const negocio = payload.negocio || 'SERVIPARTZ';
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

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Ticket</title>
<style>${THERMAL_BASE_STYLES}
${THERMAL_TICKET_VENTA_STYLES}
  .ticket-pagos { margin-top: 12px; padding-top: 10px; border-top: 1px dashed #333; font-size: 19px; line-height: 1.5; }
  .ticket-pagos .tit { font-weight: 600; margin-bottom: 6px; }
  .ticket-notas { margin-top: 12px; font-size: 20px; line-height: 1.45; text-align: center; white-space: pre-line; }
  .ticket-gracias { margin-top: 16px; text-align: center; font-size: 22px; font-weight: 600; line-height: 1.4; }
</style></head><body class="ticket-venta">
  <div class="ticket-brand-block">
    <img class="logo-ticket" src="${escapeHtml(getBrandLogoAbsoluteUrl())}" alt="" width="96" height="96" />
    <h1>${escapeHtml(negocio)}</h1>
  </div>
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
    ${
      payload.adeudoPendiente != null && payload.adeudoPendiente > 0.004
        ? `<div style="margin-top:8px;font-weight:700;color:#92400e;">Saldo pendiente (cuenta cliente): ${formatMoney(payload.adeudoPendiente)}</div>`
        : ''
    }
  </div>
  ${payload.resumenPagos?.length
    ? `<div class="ticket-pagos"><div class="tit">Pagos</div>${payload.resumenPagos
        .map((p) => {
          const tc =
            p.ultimos4 && /^\d{4}$/.test(p.ultimos4)
              ? ` · Tarj. ****${escapeHtml(p.ultimos4)}`
              : '';
          return `<div>${escapeHtml(p.label)}: ${formatMoney(p.monto)}${tc}</div>`;
        })
        .join('')}</div>`
    : ''}
  ${(() => {
    const lines = getThermalTicketSucursalFooterLines(payload.sucursalId);
    if (!lines?.length) return '';
    const [titulo, ...rest] = lines;
    const body = rest.map((ln) => `<div>${escapeHtml(ln)}</div>`).join('');
    return `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(titulo)}</div>${body}</div>`;
  })()}
  ${payload.notas ? `<p class="ticket-notas">${escapeHtml(payload.notas)}</p>` : ''}
  ${
    payload.incluirPiePoliticasRefacciones
      ? `<div class="ticket-politicas">${TICKET_POLITICAS_REFACCIONES_LINES.map(
          (ln) => `<div>${escapeHtml(ln)}</div>`
        ).join('')}</div>`
      : ''
  }
  ${
    payload.incluirPiePoliticasRefacciones && payload.folio
      ? (() => {
          const src = folioBarcodeDataUrl(payload.folio);
          if (!src) return '';
          return `<div class="ticket-barcode-wrap"><img src="${escapeHtml(src)}" alt="" style="max-width:100%;width:280px;height:auto;" /></div>`;
        })()
      : ''
  }
  <p class="ticket-gracias">${escapeHtml(payload.pieMensaje ?? '¡Gracias por su compra!')}</p>
</body></html>`;

  openAndPrintHtml(html, 'width=360,height=720', 250);
}

const COTIZACION_ESTADO_TICKET: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  convertida: 'Ya cobrada',
};

/** Cotización en rollo 80 mm (misma plantilla que ticket de venta). */
export function printThermalQuotation(
  q: Quotation,
  options?: { sucursalId?: string | null }
): void {
  const lineas = q.productos.map((it) => {
    const qty = Number(it.cantidad) || 0;
    const lineTot = Number(it.total) || 0;
    const precioUnit = qty > 0 ? lineTot / qty : 0;
    return {
      descripcion: it.producto?.nombre?.trim() || 'Producto',
      cantidad: qty,
      precioUnit,
      total: lineTot,
    };
  });

  const est = COTIZACION_ESTADO_TICKET[q.estado] ?? q.estado;
  const notasPartes = [
    `Vigencia: ${formatInAppTimezone(q.fechaVigencia, { dateStyle: 'medium' })}`,
    `Estado: ${est}`,
    q.notas?.trim() ? `Notas: ${q.notas.trim()}` : '',
  ].filter(Boolean);

  printThermalTicket({
    negocio: 'COTIZACIÓN',
    folio: q.folio,
    fecha: formatInAppTimezone(q.createdAt, { dateStyle: 'medium', timeStyle: 'short' }),
    cliente: q.cliente?.nombre ?? 'Mostrador',
    cajeroNombre: q.usuarioNombre?.trim() || undefined,
    lineas,
    subtotal: Number(q.subtotal) || 0,
    impuestos: Number(q.impuestos) || 0,
    total: Number(q.total) || 0,
    sucursalId: q.sucursalId ?? options?.sucursalId ?? undefined,
    notas: notasPartes.join('\n'),
    pieMensaje: 'Cotización sin valor fiscal. Precios y existencias sujetos a cambio.',
  });
}

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

/** Confirmación de misión de inventario completada (80 mm). */
export function printThermalMissionComplete(input: {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  articulosRevisados: number;
  totalEnMision: number;
}): void {
  const lines = getThermalTicketSucursalFooterLines(input.sucursalId);
  const pie =
    lines?.length ?
      `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(lines[0]!)}</div>${lines
        .slice(1)
        .map((ln) => `<div>${escapeHtml(ln)}</div>`)
        .join('')}</div>`
    : '';
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Misión completada</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>MISIÓN COMPLETADA</h1>
  <div class="meta">${escapeHtml(input.fechaLabel)}<br/>Cajero: ${cajero}</div>
  <p style="font-size:22px;font-weight:600;margin:12px 0;line-height:1.35;">
    Revisados en esta misión: <strong>${input.articulosRevisados}</strong> / ${input.totalEnMision}
  </p>
  <p style="font-size:19px;line-height:1.45;">Comprobante de que terminó la tarea de conteo o verificación asignada.</p>
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Movimientos de inventario del día (usuario cajero) al cerrar misión o bajo demanda (80 mm). */
export function printThermalMissionInventoryReport(input: {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  movimientos: { tipoLabel: string; linea1: string; linea2: string }[];
}): void {
  const rows =
    input.movimientos.length > 0 ?
      input.movimientos
        .map(
          (it) =>
            `<div style="border-top:1px dashed #bbb;padding-top:8px;margin-top:8px;">
  <div style="font-weight:700;font-size:21px;">${escapeHtml(it.tipoLabel)}</div>
  <div style="font-weight:600;">${escapeHtml(it.linea1.slice(0, 48))}</div>
  <div style="font-size:18px;line-height:1.35;">${escapeHtml(it.linea2)}</div>
</div>`
        )
        .join('')
    : '<p style="font-size:20px;margin:8px 0;">Sin movimientos de inventario este día (para este usuario).</p>';
  const lines = getThermalTicketSucursalFooterLines(input.sucursalId);
  const pie =
    lines?.length ?
      `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(lines[0]!)}</div>${lines
        .slice(1)
        .map((ln) => `<div>${escapeHtml(ln)}</div>`)
        .join('')}</div>`
    : '';
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Movimientos inventario</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>INVENTARIO · DÍA</h1>
  <div class="meta">${escapeHtml(input.fechaLabel)}<br/>Cajero: ${cajero}<br/>${input.movimientos.length} movimiento(s)</div>
  ${rows}
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Comprobante de abono a cuenta por cobrar (80 mm). */
export function printThermalClientAbonoReceipt(input: {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  clienteNombre: string;
  montoAbono: number;
  saldoAnterior: number;
  saldoNuevo: number;
}): void {
  const lines = getThermalTicketSucursalFooterLines(input.sucursalId);
  const pie =
    lines?.length ?
      `<div class="pie-sucursal"><div class="titulo-suc">${escapeHtml(lines[0]!)}</div>${lines
        .slice(1)
        .map((ln) => `<div>${escapeHtml(ln)}</div>`)
        .join('')}</div>`
    : '';
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const cliente = input.clienteNombre.trim() ? escapeHtml(input.clienteNombre.trim()) : 'Cliente';
  const saldoNuevo = Math.max(0, Number(input.saldoNuevo) || 0);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Comprobante de abono</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>COMPROBANTE DE ABONO</h1>
  <div class="meta">
    ${escapeHtml(input.fechaLabel)}<br/>
    Cliente: ${cliente}<br/>
    Cajero: ${cajero}
  </div>
  <div class="tot" style="border-top:none;padding-top:8px;font-size:21px;line-height:1.5;">
    <div>Saldo anterior: ${formatMoney(Number(input.saldoAnterior) || 0)}</div>
    <div>Abono recibido: ${formatMoney(Number(input.montoAbono) || 0)}</div>
    <div style="margin-top:6px;font-size:26px;"><strong>Saldo actual: ${formatMoney(saldoNuevo)}</strong></div>
  </div>
  <p style="margin-top:12px;font-size:19px;line-height:1.4;text-align:center;">
    Gracias. Conserve este comprobante como respaldo de su pago.
  </p>
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
        : v.estado === 'pendiente' ? ' (abierta)'
        : '';
      return `<tr><td>${escapeHtml(v.folio)}${st}</td><td class="right">${formatMoney(Number(v.total) || 0)}</td></tr>`;
    })
    .join('');
  const bruto = list
    .filter((v) => v.estado !== 'cancelada' && v.estado !== 'pendiente')
    .reduce((s, v) => s + (Number(v.total) || 0), 0);

  const grupos = resumenGruposMedioPagoCierre(input.ventas);
  const porForma = totalesPorFormaPago(input.ventas);
  const formaRows = Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([clave, m]) =>
        `<tr><td>${escapeHtml(labelFormaPagoCaja(clave))}</td><td class="right">${formatMoney(Number(m) || 0)}</td></tr>`
    )
    .join('');

  const completadasDia = list.filter((v) => v.estado === 'completada');
  const totalAdeudoDia = completadasDia.reduce((s, v) => s + computeSaleClienteAdeudo(v), 0);
  const adeudoRedondeado = Math.round(totalAdeudoDia * 100) / 100;
  const adeudoStyle = adeudoRedondeado > 0.004 ? 'color:#92400e;' : '';

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
  <div class="tot" style="border-top:none;padding-top:8px;font-size:20px;">
    <div><strong>Resumen medios</strong> <span style="font-size:14px;">(cobros en ventas completadas)</span></div>
    <div>Efectivo: ${formatMoney(grupos.efectivoCobros)}</div>
    <div>Tarjetas: ${formatMoney(grupos.tarjetas)}</div>
    <div>Otros: ${formatMoney(grupos.otros)}</div>
  </div>
  <p style="font-size:19px;font-weight:600;margin:10px 0 4px;">Cobros por forma de pago</p>
  <table>${formaRows || '<tr><td>Sin cobros registrados</td></tr>'}</table>
  <div class="tot"><strong>Total día: ${formatMoney(bruto)}</strong><br/><span style="font-size:14px;">Sin canceladas ni ventas abiertas</span></div>
  <div class="tot" style="border-top:none;padding-top:8px;">
    <div style="font-size:20px;"><strong>Saldo pendiente por cobrar (día)</strong></div>
    <div style="font-size:26px;font-weight:700;${adeudoStyle}">${formatMoney(adeudoRedondeado)}</div>
    <span style="font-size:14px;">Lo que quedó por cobrar en ventas completadas del día (parciales / crédito). Si es $0.00, no hubo adeudos.</span>
  </div>
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Comprobante de cierre de caja o arqueo previo (80 mm). */
export function printThermalCajaCierre(input: {
  fechaLabel: string;
  sucursalId?: string;
  ventas: Sale[];
  fondoInicial: number;
  conteoDeclarado: number;
  efectivoEsperado: number;
  diferencia: number;
  ticketsCompletados: number;
  totalVentasBruto: number;
  abiertaPor: string;
  cerradaPor: string;
  aperturaLabel: string;
  cierreLabel: string;
  /** Suma de aportes en efectivo en la sesión (ya sumada al efectivo esperado). */
  aportesEfectivoTotal?: number;
  aportesEfectivo?: CajaAporteEfectivo[];
  /** Suma de retiros a bóveda/banco en la sesión (ya descontada del efectivo esperado). */
  retirosEfectivoTotal?: number;
  /** Detalle de cada retiro (impresión / cuadre). */
  retirosEfectivo?: CajaRetiroEfectivo[];
  /** `arqueo_previo`: sin conteo físico ni diferencia; título distinto. */
  ticketKind?: 'cierre' | 'arqueo_previo';
}): void {
  const grupos = resumenGruposMedioPagoCierre(input.ventas);
  const porForma = totalesPorFormaPago(input.ventas);
  const formaRows = Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([clave, m]) =>
        `<tr><td>${escapeHtml(labelFormaPagoCaja(clave))}</td><td class="right">${formatMoney(Number(m) || 0)}</td></tr>`
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
  const esArqueo = input.ticketKind === 'arqueo_previo';
  const titulo = esArqueo ? 'ARQUEO PREVIO' : 'CIERRE DE CAJA';
  const metaCierre = esArqueo
    ? `Impreso: ${escapeHtml(input.cierreLabel)} · ${escapeHtml(input.cerradaPor)}`
    : `Cierre: ${escapeHtml(input.cierreLabel)} · ${escapeHtml(input.cerradaPor)}`;
  const bloqueConteo = esArqueo
    ? ''
    : `<div>Conteo físico: ${formatMoney(input.conteoDeclarado)}</div>
    <div>Diferencia: ${formatMoney(input.diferencia)}</div>`;

  const aportes =
    (Number(input.aportesEfectivoTotal) || 0) > 0.005
      ? `<div>Aportes de efectivo (sesión): +${formatMoney(Number(input.aportesEfectivoTotal) || 0)}</div>`
      : '';
  const aportesLista = (() => {
    const list = input.aportesEfectivo;
    if (!list?.length) return '';
    const sorted = [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const rows = sorted
      .map((r) => {
        const meta = `${formatInAppTimezone(r.createdAt, { dateStyle: 'short', timeStyle: 'short' })} · ${r.usuarioNombre}`;
        const notas = r.notas?.trim() ? ` — ${r.notas.trim()}` : '';
        return `<div style="font-size:18px;margin:3px 0;line-height:1.25;">${escapeHtml(meta)} · +${formatMoney(r.monto)}${escapeHtml(notas)}</div>`;
      })
      .join('');
    return `<div style="font-size:19px;font-weight:600;margin:8px 0 2px;">Detalle aportes</div>${rows}`;
  })();
  const retiros =
    (Number(input.retirosEfectivoTotal) || 0) > 0.005
      ? `<div>Retiros de efectivo (sesión): −${formatMoney(Number(input.retirosEfectivoTotal) || 0)}</div>`
      : '';
  const retirosLista = (() => {
    const list = input.retirosEfectivo;
    if (!list?.length) return '';
    const sorted = [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const rows = sorted
      .map((r) => {
        const meta = `${formatInAppTimezone(r.createdAt, { dateStyle: 'short', timeStyle: 'short' })} · ${r.usuarioNombre}`;
        const notas = r.notas?.trim() ? ` — ${r.notas.trim()}` : '';
        return `<div style="font-size:18px;margin:3px 0;line-height:1.25;">${escapeHtml(meta)} · −${formatMoney(r.monto)}${escapeHtml(notas)}</div>`;
      })
      .join('');
    return `<div style="font-size:19px;font-weight:600;margin:8px 0 2px;">Detalle retiros</div>${rows}`;
  })();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(titulo)}</title>
<style>${THERMAL_BASE_STYLES}</style></head><body>
  <h1>${escapeHtml(titulo)}</h1>
  <div class="meta">
    ${escapeHtml(input.fechaLabel)}<br/>
    Apertura: ${escapeHtml(input.aperturaLabel)} · ${escapeHtml(input.abiertaPor)}<br/>
    ${metaCierre}
  </div>
  <div class="tot" style="border-top:none;padding-top:4px;">
    <div>Fondo inicial: ${formatMoney(input.fondoInicial)}</div>
    <div>Tickets cobrados: ${input.ticketsCompletados}</div>
    <div>Venta neta (completadas): ${formatMoney(input.totalVentasBruto)}</div>
  </div>
  <div class="tot" style="border-top:none;padding-top:8px;font-size:20px;">
    <div><strong>Resumen medios</strong></div>
    <div>Efectivo: ${formatMoney(grupos.efectivoCobros)}</div>
    <div>Tarjetas: ${formatMoney(grupos.tarjetas)}</div>
    <div>Otros: ${formatMoney(grupos.otros)}</div>
  </div>
  <p style="font-size:19px;font-weight:600;margin:10px 0 4px;">Cobros por forma de pago</p>
  <table>${formaRows || '<tr><td>Sin cobros registrados</td></tr>'}</table>
  <div class="tot">
    <div><strong>Efectivo esperado en caja</strong></div>
    ${aportes}
    ${aportesLista}
    ${retiros}
    ${retirosLista}
    <div style="font-size:26px;"><strong>${formatMoney(input.efectivoEsperado)}</strong></div>
    ${bloqueConteo}
  </div>
  ${pie}
</body></html>`;
  openAndPrintHtml(html, 'width=360,height=720', 250);
}

/** Texto estándar para documentos que no son válidos ante el SAT. */
export const AVISO_DOC_FISCAL_PRUEBA =
  'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL ANTE EL SAT';

/** Documento tamaño carta (facturas / cotizaciones) en ventana de impresión. */
export function printLetterDocument(
  title: string,
  innerHtml: string,
  options?: { sucursalId?: string | null; avisoPrueba?: string }
): void {
  const head = buildLetterHeaderHtml();
  const foot = buildLetterFooterHtml(options?.sucursalId);
  const aviso =
    options?.avisoPrueba != null && options.avisoPrueba !== ''
      ? `<div class="aviso-prueba">${escapeHtml(options.avisoPrueba)}</div>`
      : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: system-ui, sans-serif; font-size: 11pt; color: #111; line-height: 1.4; }
  h1 { font-size: 16pt; margin: 0 0 12px; }
  h2 { font-size: 12pt; margin: 16px 0 8px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border-bottom: 1px solid #ccc; padding: 6px 4px; text-align: left; }
  th { font-size: 10pt; color: #444; }
  .right { text-align: right; }
  .tot { margin-top: 16px; font-size: 12pt; }
  .aviso-prueba {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 2px solid #b45309;
    background: #fffbeb;
    color: #92400e;
    font-weight: 700;
    font-size: 10.5pt;
    text-align: center;
  }
  .muted { font-size: 9.5pt; color: #555; margin-top: 14px; line-height: 1.45; }
</style></head><body>
${head}
<h1>${escapeHtml(title)}</h1>
${aviso}
${innerHtml}
${foot}
</body></html>`;

  openCfdiLetterPrint(html, { printDelayMs: 300 });
}

export type {
  NominaPruebaPrintInput,
  NominaPruebaDraftForm,
} from '@/lib/cfdiRepresentacionImpresa';

/** Recibo de nómina (prueba) — formato compacto carta (`cfdiRepresentacionImpresa`, import dinámico). */
export function printNominaPruebaLetter(input: NominaPruebaPrintInput): void {
  void import('@/lib/cfdiRepresentacionImpresa').then(({ printNominaPruebaCfdiLetter }) => {
    printNominaPruebaCfdiLetter(input);
  });
}

/** Reimprimir ticket a partir de una venta guardada (POS / historial). */
export async function printThermalTicketFromSale(sale: Sale): Promise<void> {
  const cliente = await resolveClienteTicketLabel(sale);
  const catalog = getProductCatalogSnapshot();

  const lineas = (sale.productos ?? []).map((item) => {
    const desc =
      item.producto?.nombre?.trim() ||
      item.productoNombre?.trim() ||
      catalog.find((p) => p.id === item.productId)?.nombre?.trim() ||
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

  const adeudoTicket = computeSaleClienteAdeudo(sale);

  printThermalTicket({
    negocio: 'SERVIPARTZ',
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
    adeudoPendiente: adeudoTicket > 0 ? adeudoTicket : undefined,
    resumenPagos: resumenPagos.length > 0 ? resumenPagos : undefined,
    notas: (() => {
      if (sale.estado === 'cancelada') return thermalTicketCancelacionNotas(sale);
      const base = sale.notas ? String(sale.notas) : '';
      if (sale.estado === 'pendiente') {
        const extra = 'PENDIENTE DE COBRO — El importe no cuenta como venta cobrada hasta completar el pago en POS.';
        return base ? `${base}\n${extra}` : extra;
      }
      return base || undefined;
    })(),
    incluirPiePoliticasRefacciones: sale.estado === 'completada' || sale.estado === 'facturada',
  });
}
