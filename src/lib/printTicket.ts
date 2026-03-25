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
  type CajaRetiroEfectivo,
  type FiscalConfig,
  type Quotation,
  type Sale,
} from '@/types';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { thermalTicketCancelacionNotas } from '@/lib/saleCancelacion';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { getProductCatalogSnapshot } from '@/lib/firestore/productsFirestore';
import { labelFormaPagoCaja, resumenGruposMedioPagoCierre, totalesPorFormaPago } from '@/lib/cajaResumen';

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
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** CSS compartido: ticket de venta 80 mm e informes térmicos (tipografía grande para leer en papel). */
const THERMAL_BASE_STYLES = `@page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 22px; color: #111; width: 72mm; margin: 0 auto; padding: 4px; }
  h1 { font-size: 28px; text-align: center; margin: 0 0 10px; line-height: 1.15; }
  .meta { font-size: 18px; margin-bottom: 10px; border-bottom: 1px dashed #333; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; vertical-align: top; font-size: 20px; }
  td.desc { font-weight: 600; padding-top: 10px; font-size: 21px; }
  td.right { text-align: right; white-space: nowrap; }
  .tot { margin-top: 12px; border-top: 1px dashed #333; padding-top: 10px; font-size: 22px; }
  .tot strong { font-size: 30px; }
  .pie-sucursal { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #999; text-align: center; font-size: 21px; line-height: 1.55; font-weight: 500; color: #111; width: 100%; }
  .pie-sucursal .titulo-suc { font-weight: 800; font-size: 26px; margin-bottom: 8px; text-align: center; letter-spacing: 0.02em; }
  .pie-sucursal > div { text-align: center; }`;

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
<style>${THERMAL_BASE_STYLES}
  .logo-ticket { display: block; margin: 0 0 10px 0; margin-right: auto; max-width: 30mm; height: auto; }
  .ticket-pagos { margin-top: 12px; padding-top: 10px; border-top: 1px dashed #333; font-size: 19px; line-height: 1.5; }
  .ticket-pagos .tit { font-weight: 600; margin-bottom: 6px; }
  .ticket-notas { margin-top: 12px; font-size: 20px; line-height: 1.45; text-align: center; white-space: pre-line; }
  .ticket-gracias { margin-top: 16px; text-align: center; font-size: 22px; font-weight: 600; line-height: 1.4; }
</style></head><body>
  <img class="logo-ticket" src="${escapeHtml(getBrandLogoAbsoluteUrl())}" alt="" width="96" height="96" />
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
  <div class="tot"><strong>Total día: ${formatMoney(bruto)}</strong><br/><span style="font-size:14px;">Sin canceladas ni ventas abiertas</span></div>
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

  openAndPrintHtml(html, 'width=816,height=1056', 300);
}

export type NominaPruebaPrintInput = {
  config: FiscalConfig;
  serie: string;
  folio: string;
  sucursalId?: string | null;
};

/**
 * Representación impresa de ejemplo para CFDI de nómina (sin XML ni timbre).
 * Datos del trabajador y montos son ficticios para revisar maquetación.
 */
export function printNominaPruebaLetter(input: NominaPruebaPrintInput): void {
  const { config, serie, folio } = input;
  const fecha = formatInAppTimezone(new Date(), { dateStyle: 'long', timeStyle: 'short' });
  const cp = config.lugarExpedicion || '—';
  const dir = config.direccion;
  const domicilioEmisor = [
    dir?.calle,
    dir?.numeroExterior,
    dir?.colonia,
    dir?.codigoPostal,
    dir?.ciudad || dir?.municipio,
    dir?.estado,
  ]
    .filter(Boolean)
    .join(', ');

  const inner = `
    <p><strong>Serie:</strong> ${escapeHtml(serie)} &nbsp; <strong>Folio:</strong> ${escapeHtml(folio)}</p>
    <p><strong>Fecha y hora:</strong> ${escapeHtml(fecha)}</p>
    <p><strong>Tipo:</strong> Nómina (representación impresa de prueba)</p>

    <h2>Emisor</h2>
    <p><strong>RFC:</strong> ${escapeHtml(config.rfc)}<br/>
    <strong>Razón social:</strong> ${escapeHtml(config.razonSocial)}<br/>
    <strong>Régimen fiscal:</strong> ${escapeHtml(config.regimenFiscal)}<br/>
    <strong>Lugar de expedición:</strong> ${escapeHtml(cp)}<br/>
    ${domicilioEmisor ? `<strong>Domicilio:</strong> ${escapeHtml(domicilioEmisor)}` : ''}</p>

    <h2>Receptor (ejemplo para maquetación)</h2>
    <p><strong>Nombre:</strong> MARÍA FICTICIA PÉREZ GARCÍA<br/>
    <strong>RFC:</strong> XAXX010101000<br/>
    <strong>Núm. empleado:</strong> 001<br/>
    <strong>CURP:</strong> XXXX000000HDFXXX00<br/>
    <strong>Departamento:</strong> Operaciones<br/>
    <strong>Puesto:</strong> Auxiliar administrativo</p>

    <p><strong>Periodo de pago:</strong> 1 al 15 de marzo 2026 (ejemplo)</p>
    <p><strong>Días pagados:</strong> 15 &nbsp; <strong>Tipo nómina:</strong> O (ordinaria)</p>

    <h2>Percepciones</h2>
    <table>
      <thead><tr><th>Clave</th><th>Concepto</th><th class="right">Importe gravado</th><th class="right">Importe exento</th></tr></thead>
      <tbody>
        <tr><td>001</td><td>Sueldos, salarios y jornales</td><td class="right">${formatMoney(8500)}</td><td class="right">${formatMoney(0)}</td></tr>
        <tr><td>038</td><td>Bono de desempeño (ejemplo)</td><td class="right">${formatMoney(500)}</td><td class="right">${formatMoney(0)}</td></tr>
      </tbody>
    </table>

    <h2>Deducciones</h2>
    <table>
      <thead><tr><th>Clave</th><th>Concepto</th><th class="right">Importe</th></tr></thead>
      <tbody>
        <tr><td>002</td><td>ISR</td><td class="right">${formatMoney(1240)}</td></tr>
        <tr><td>021</td><td>IMSS</td><td class="right">${formatMoney(285)}</td></tr>
      </tbody>
    </table>

    <div class="tot">
      <p>Total percepciones: ${formatMoney(9000)}</p>
      <p>Total deducciones: ${formatMoney(1525)}</p>
      <p><strong>Neto a pagar: ${formatMoney(7475)}</strong></p>
    </div>

    <p class="muted">
      Este recibo es solo una vista previa de impresión. Para que una nómina sea válida ante el SAT hace falta
      generar el XML con complemento de nómina, usar la serie y folio del rango autorizado, sellar con tu CSD y
      timbrar con un PAC autorizado. Cuando desactives el modo de prueba y guardes los folios oficiales de nómina,
      el sistema podrá usar esa numeración en la generación real (junto al servicio de timbrado).
    </p>
  `;

  printLetterDocument('Recibo de nómina (prueba)', inner, {
    sucursalId: input.sucursalId,
    avisoPrueba: AVISO_DOC_FISCAL_PRUEBA,
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
  });
}
