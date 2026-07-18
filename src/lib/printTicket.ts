import type { NominaPruebaPrintInput } from '@/lib/cfdiRepresentacionImpresa';
import { formatMoney } from '@/lib/utils';
import { getThermalTicketSucursalFooterLines } from '@/lib/ticketSucursalFooter';
import {
  buildLetterFooterHtml,
  buildLetterHeaderHtml,
  buildThermalBrandBlockHtml,
  resolveBrandLogoDataUrlForPrint,
} from '@/lib/documentPrintBranding';
import { getClientById } from '@/db/database';
import {
  FORMAS_PAGO,
  type CajaAbonoCobro,
  type CajaAporteEfectivo,
  type CajaCierreTerminal,
  type CajaRetiroEfectivo,
  type Client,
  type Quotation,
  type Sale,
} from '@/types';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { thermalTicketCancelacionNotas } from '@/lib/saleCancelacion';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { nombreClienteVenta, nombreCajeroVenta } from '@/lib/saleTicketUi';
import { saleFechaHistorial } from '@/lib/saleHistorialFecha';
import { getProductCatalogSnapshot } from '@/lib/firestore/productsFirestore';
import {
  buildHistorialCobrosMovimientos,
  computeCobradoPeriodo,
  labelFormaPagoCaja,
  resumenGruposMedioPagoCierre,
  totalesPorFormaPago,
} from '@/lib/cajaResumen';
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

/** Tamaño mínimo legible en ticket térmico (folio, horario, leyendas finales). */
const THERMAL_MIN_FONT_PX = 9;

/** Cuerpo del ticket: productos, totales, pagos y pie de sucursal (Olivares → horario). */
const THERMAL_BODY_FONT_PX = 10;

/** Logo en rollo 80 mm: mitad del tamaño anterior (28 mm → 14 mm). */
const THERMAL_LOGO_WIDTH_MM = 14;

/** Antepone el scope solo a los selectores de cada bloque `{…}` (no a las propiedades). */
function scopeThermalCss(css: string, scope: string): string {
  return css.replace(/([^{}]+)\{([^}]*)\}/g, (_match, selectors: string, rules: string) => {
    const scoped = selectors
      .trim()
      .split(',')
      .map((s) => `${scope} ${s.trim()}`)
      .join(', ');
    return `${scoped} {${rules}}`;
  });
}

const THERMAL_PIE_LINE_INLINE_STYLE = `text-align:center;width:100%;font-size:${THERMAL_BODY_FONT_PX}px;line-height:1.2;margin:0;padding:0;`;

function buildThermalPieSucursalHtml(sucursalId?: string | null): string {
  const lines = getThermalTicketSucursalFooterLines(sucursalId);
  if (!lines?.length) return '';
  const [titulo, ...rest] = lines;
  const body = rest
    .map((ln) => `<div style="${THERMAL_PIE_LINE_INLINE_STYLE}">${escapeHtml(ln)}</div>`)
    .join('');
  const tituloStyle = `${THERMAL_PIE_LINE_INLINE_STYLE}font-weight:800;`;
  return `<div class="pie-sucursal" style="text-align:center;width:100%;">
    <div class="titulo-suc" style="${tituloStyle}"><strong>${escapeHtml(titulo)}</strong></div>
    ${body}
  </div>`;
}

/** Pie de sucursal (Olivares / contacto / horario): mismo tamaño que productos y totales. */
const THERMAL_PIE_SUCURSAL_CSS = `
  .pie-sucursal {
    display: block;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed #999;
    text-align: center !important;
    font-size: ${THERMAL_BODY_FONT_PX}px !important;
    line-height: 1.2;
    font-weight: 500;
    color: #111;
    width: 100%;
    box-sizing: border-box;
  }
  .pie-sucursal .titulo-suc {
    display: block;
    font-weight: 800 !important;
    font-size: ${THERMAL_BODY_FONT_PX}px !important;
    margin: 0 0 1px;
    line-height: 1.2;
    text-align: center !important;
    width: 100%;
    letter-spacing: 0;
  }
  .pie-sucursal > div {
    display: block;
    text-align: center !important;
    font-size: ${THERMAL_BODY_FONT_PX}px !important;
    line-height: 1.2;
    width: 100%;
    margin: 0;
    padding: 0;
  }`;

/**
 * Solo `printThermalTicket` (venta, cotización impresa como ticket, devolución):
 * Tipografía compacta al 80 mm; columna centrada sin corrimiento (evita corte a la izquierda).
 */
const THERMAL_TICKET_VENTA_STYLES = `
  @page { size: 80mm auto; margin: 5.5mm 5.5mm 6mm 5.5mm; }
  body.ticket-venta {
    position: static;
    width: 64mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 5px 4px 8px;
    font-size: 11px;
    line-height: 1.2;
  }
  body.ticket-venta h1,
  body.ticket-venta .ticket-brand-block h1 {
    font-size: 14px !important;
    margin: 0 0 4px !important;
    line-height: 1.15 !important;
  }
  body.ticket-venta .ticket-brand-block { margin-bottom: 4px; }
  body.ticket-venta .ticket-brand-block .logo-ticket {
    display: block !important;
    max-width: ${THERMAL_LOGO_WIDTH_MM}mm;
    width: ${THERMAL_LOGO_WIDTH_MM}mm;
    height: auto;
    object-fit: contain;
    margin: 0 auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.ticket-venta .meta {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    margin-bottom: 4px;
    padding-bottom: 3px;
    line-height: 1.2;
    border-bottom: 1px dashed #333;
  }
  body.ticket-venta table { table-layout: fixed; width: 100%; border-collapse: collapse; }
  body.ticket-venta td {
    font-size: ${THERMAL_BODY_FONT_PX}px;
    padding: 0;
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-venta td.desc { font-size: ${THERMAL_BODY_FONT_PX}px; font-weight: 600; padding-top: 3px; }
  body.ticket-venta td.right { white-space: normal; text-align: right; }
  body.ticket-venta .tot {
    font-size: ${THERMAL_BODY_FONT_PX}px;
    margin-top: 4px;
    padding-top: 4px;
    line-height: 1.2;
    border-top: 1px dashed #333;
  }
  body.ticket-venta .tot strong { font-size: 13px; }
  body.ticket-venta .ticket-pagos {
    font-size: ${THERMAL_BODY_FONT_PX}px !important;
    line-height: 1.2;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed #333;
  }
  body.ticket-venta .ticket-pagos .tit { font-weight: 600; margin-bottom: 2px; }
  body.ticket-venta .meta,
  body.ticket-venta .tot,
  body.ticket-venta .ticket-pagos,
  body.ticket-venta .pie-sucursal,
  body.ticket-venta .ticket-politicas,
  body.ticket-venta .ticket-notas {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
${scopeThermalCss(THERMAL_PIE_SUCURSAL_CSS, 'body.ticket-venta')}
  body.ticket-venta .ticket-notas {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.15;
    margin-top: 4px;
    text-align: center;
    white-space: pre-line;
  }
  body.ticket-venta .ticket-politicas {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.15;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed #666;
    text-align: center;
    font-weight: 600;
  }
  body.ticket-venta .ticket-politicas div + div { margin-top: 1px; }
  body.ticket-venta .ticket-barcode-wrap { margin-top: 5px; text-align: center; }
  body.ticket-venta .ticket-barcode-wrap img {
    width: 180px !important;
    max-width: 100% !important;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  body.ticket-venta .ticket-gracias {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.15;
    margin-top: 5px;
    font-weight: 600;
    text-align: center;
  }`;

/**
 * Documentos térmicos genéricos (abono, stock bajo, misiones, etc.):
 * misma columna compacta que venta; logo con corrección óptica a la izquierda.
 */
const THERMAL_COMPACT_SHELL_STYLES = `
  @page { size: 80mm auto; margin: 5.5mm 5.5mm 6mm 5.5mm; }
  * { box-sizing: border-box; }
  body.ticket-compact {
    position: static;
    width: 64mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 5px 4px 8px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11px;
    line-height: 1.2;
    color: #111;
  }
  body.ticket-compact .ticket-brand-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    margin: 0 0 4px;
    padding: 0;
  }
  body.ticket-compact .ticket-brand-block .logo-ticket {
    display: block !important;
    max-width: ${THERMAL_LOGO_WIDTH_MM}mm;
    width: ${THERMAL_LOGO_WIDTH_MM}mm;
    height: auto;
    object-fit: contain;
    margin: 0 auto;
    transform: translateX(-1.2mm);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.ticket-compact .ticket-brand-block h1 {
    margin: 3px 0 0 !important;
    width: 100%;
    text-align: center !important;
    font-size: 14px !important;
    line-height: 1.15 !important;
  }
  body.ticket-compact .meta {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    margin-bottom: 4px;
    border-bottom: 1px dashed #333;
    padding-bottom: 3px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-compact table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  body.ticket-compact td {
    padding: 0;
    vertical-align: top;
    font-size: 10px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-compact td.right { text-align: right; white-space: normal; }
  body.ticket-compact .tot {
    margin-top: 4px;
    border-top: 1px dashed #333;
    padding-top: 4px;
    font-size: 10px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-compact .tot strong { font-size: 13px; }
  body.ticket-compact p,
  body.ticket-compact .ticket-body-text {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
${scopeThermalCss(THERMAL_PIE_SUCURSAL_CSS, 'body.ticket-compact')}
  body.ticket-compact .ticket-rol {
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    margin: -2px 0 4px;
    line-height: 1.15;
  }
  body.ticket-compact .abono-saldos { border-top: none; padding-top: 4px; }
  body.ticket-compact .abono-saldos > div { font-size: 10px; line-height: 1.2; }
  body.ticket-compact .abono-saldo-actual {
    margin-top: 3px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
  }
  body.ticket-compact .abono-nota {
    margin-top: 4px;
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.15;
    text-align: center;
  }
  body.ticket-compact .ticket-body-text {
    font-size: 10px;
    line-height: 1.2;
    margin: 4px 0;
  }
  body.ticket-compact .ticket-body-text strong { font-size: 11px; }
  body.ticket-compact .ticket-section-title {
    font-size: 10px;
    font-weight: 600;
    margin: 4px 0 2px;
    line-height: 1.2;
  }
  body.ticket-compact .ticket-mov-block {
    border-top: 1px dashed #bbb;
    padding-top: 3px;
    margin-top: 3px;
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.15;
  }
  body.ticket-compact .ticket-mov-block .mov-tipo { font-weight: 700; font-size: 10px; }
  body.ticket-compact .ticket-mov-block .mov-linea { font-weight: 600; }
  body.ticket-compact .ticket-mision-item {
    border-top: 1px dashed #bbb;
    padding-top: 3px;
    margin-top: 3px;
    font-size: ${THERMAL_MIN_FONT_PX}px;
    line-height: 1.2;
  }
  body.ticket-compact .ticket-mision-item .mision-nombre { font-weight: 700; font-size: 10px; }
  body.ticket-compact .ticket-mision-item .mision-fisico {
    margin-top: 2px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
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
  .ticket-politicas { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #666; font-size: 17px; line-height: 1.45; text-align: center; color: #111; font-weight: 600; }
  .ticket-politicas div + div { margin-top: 6px; }
  .ticket-barcode-wrap { margin-top: 14px; text-align: center; }
  .ticket-barcode-wrap img { display: block; margin: 0 auto; max-width: 100%; height: auto; image-rendering: pixelated; }`;

/**
 * Cierre de turno (sesión de caja), arqueo previo y reporte de ventas de la sesión:
 * rollo 80 mm con el mismo ancho útil y márgenes que `ticket-venta` (impresora térmica).
 */
const THERMAL_CIERRE_TURNO_STYLES = `
  @page { size: 80mm auto; margin: 5.5mm 5.5mm 6mm 5.5mm; }
  @media print {
    html { width: 80mm; margin: 0 auto; }
  }
  * { box-sizing: border-box; }
  body.ticket-cierre-turno {
    position: static;
    width: 64mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 5px 4px 8px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11px;
    line-height: 1.2;
    color: #111;
  }
  body.ticket-cierre-turno .ticket-brand-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    margin: 0 0 4px;
  }
  body.ticket-cierre-turno .ticket-brand-block .logo-ticket {
    display: block !important;
    max-width: ${THERMAL_LOGO_WIDTH_MM}mm;
    width: ${THERMAL_LOGO_WIDTH_MM}mm;
    height: auto;
    object-fit: contain;
    margin: 0 auto;
    transform: translateX(-1.2mm);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.ticket-cierre-turno .ticket-brand-block h1 {
    font-size: 14px !important;
    text-align: center;
    margin: 3px 0 0 !important;
    line-height: 1.15;
    width: 100%;
  }
  body.ticket-cierre-turno h1 {
    font-size: 14px;
    text-align: center;
    margin: 0 0 4px;
    line-height: 1.15;
  }
  body.ticket-cierre-turno .meta {
    font-size: ${THERMAL_MIN_FONT_PX}px;
    margin-bottom: 4px;
    border-bottom: 1px dashed #333;
    padding-bottom: 3px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-cierre-turno table { table-layout: fixed; width: 100%; border-collapse: collapse; }
  body.ticket-cierre-turno td {
    font-size: 10px;
    padding: 0;
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-cierre-turno td.right { text-align: right; white-space: normal; }
  body.ticket-cierre-turno .tot {
    margin-top: 4px;
    border-top: 1px dashed #333;
    padding-top: 4px;
    font-size: 10px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-cierre-turno .tot strong { font-size: 13px; }
  body.ticket-cierre-turno p {
    font-size: 10px;
    line-height: 1.2;
    margin: 4px 0 2px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  body.ticket-cierre-turno .ticket-section-title {
    font-size: 10px;
    font-weight: 600;
    margin: 4px 0 2px;
    line-height: 1.2;
  }
${scopeThermalCss(THERMAL_PIE_SUCURSAL_CSS, 'body.ticket-cierre-turno')}
`;

/** ~80 mm de ancho en pantalla previa (96 DPI) para ventana de impresión térmica. */
const THERMAL_80MM_WINDOW_FEATURES = 'width=302,height=720';

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
      height: 44,
      displayValue: true,
      fontSize: 12,
      margin: 4,
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

/** Espera a que carguen imágenes (logo) antes de `print()`; evita tickets sin logo. */
function injectPrintWhenReadyScript(html: string): string {
  const script = `<script>
(function(){
  var MIN_MS=120,MAX_MS=12000,t0=Date.now(),done=false;
  function doPrint(){
    if(done)return;
    done=true;
    try{window.focus();window.print();}catch(e){}
  }
  function afterMin(cb){
    var w=Math.max(0,MIN_MS-(Date.now()-t0));
    setTimeout(cb,w);
  }
  function whenImagesReady(cb){
    var imgs=[].slice.call(document.images||[]);
    if(!imgs.length){cb();return;}
    var left=imgs.length;
    function onDone(){if(--left<=0)cb();}
    imgs.forEach(function(img){
      if(img.complete)onDone();
      else{
        img.addEventListener("load",onDone,{once:true});
        img.addEventListener("error",onDone,{once:true});
      }
    });
    setTimeout(cb,MAX_MS);
  }
  function start(){
    afterMin(function(){whenImagesReady(doPrint);});
  }
  if(document.readyState==="complete")start();
  else window.addEventListener("load",start,{once:true});
})();
</script>`;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, (m) => `${script}${m}`);
  return `${html}${script}`;
}

function isMobileLikeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS con "Solicitar sitio de escritorio" se anuncia como Macintosh pero tiene touch.
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

function extractHtmlTitle(html: string): string {
  const m = /<title>([^<]*)<\/title>/i.exec(html);
  return m?.[1]?.trim() || 'Documento de impresión';
}

/**
 * Cuando el navegador bloquea la pestaña (p. ej. segundo documento en el mismo toque:
 * arqueo + reporte de ventas), muestra un aviso con botón; el toque del usuario cuenta
 * como gesto nuevo y la pestaña ya se puede abrir.
 */
function showBlockedPrintTabNotice(url: string, docTitle: string): void {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;' +
    'display:flex;align-items:center;gap:10px;max-width:min(92vw,26rem);padding:10px 12px;border-radius:14px;' +
    'background:#0f172a;color:#f1f5f9;box-shadow:0 10px 30px rgba(0,0,0,.45);font:500 13px/1.35 system-ui,sans-serif';

  const label = document.createElement('span');
  label.style.cssText = 'min-width:0;flex:1;overflow-wrap:anywhere';
  label.textContent = `Listo: ${docTitle}`;

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Ver / imprimir';
  openBtn.style.cssText =
    'flex-shrink:0;border:0;border-radius:10px;padding:8px 12px;background:#06b6d4;color:#082f49;font:600 13px system-ui,sans-serif;cursor:pointer';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Descartar');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'flex-shrink:0;border:0;border-radius:10px;padding:8px 10px;background:transparent;color:#94a3b8;font:600 13px system-ui,sans-serif;cursor:pointer';

  const tearDown = () => {
    window.clearTimeout(autoHide);
    if (host.parentNode) host.parentNode.removeChild(host);
  };
  const autoHide = window.setTimeout(tearDown, 90_000);

  openBtn.addEventListener('click', () => {
    window.open(url, '_blank');
    tearDown();
  });
  closeBtn.addEventListener('click', tearDown);

  host.appendChild(label);
  host.appendChild(openBtn);
  host.appendChild(closeBtn);
  document.body.appendChild(host);
}

/**
 * Móvil: abre el documento en pestaña nueva con URL `blob:`. En Chrome Android,
 * `window.open('about:blank', …features)` suele devolver `null` (y `print()` desde un
 * iframe oculto no está soportado), por lo que con la ruta de escritorio la pantalla
 * del reporte nunca aparecía. Con `blob:` la pestaña carga el contenido por sí misma,
 * sin depender de `document.write` sobre la referencia devuelta.
 */
function openPrintTabOnMobile(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.setTimeout(() => URL.revokeObjectURL(url), 180_000);
  const w = window.open(url, '_blank');
  if (w) return;
  showBlockedPrintTabNotice(url, extractHtmlTitle(html));
}

/**
 * Abre HTML para imprimir. Escritorio: `about:blank` + `document.write` (no `blob:` URL),
 * así el pie del diálogo de impresión no muestra una URL `blob:https://…` larga.
 * Sin `noopener` en window.open: en Chrome móvil a veces devuelve `null` pero abre pestaña;
 * si el popup está bloqueado, se usa iframe `about:blank` + write + print().
 * Móvil: pestaña con URL `blob:` (ver `openPrintTabOnMobile`); sin script de autocierre
 * para que el documento quede visible aunque el usuario cancele la impresión.
 */
function openAndPrintHtml(html: string, windowFeatures: string): void {
  if (isMobileLikeBrowser()) {
    openPrintTabOnMobile(injectPrintWhenReadyScript(html));
    return;
  }

  const htmlWithClose = injectPrintCloseScript(injectPrintWhenReadyScript(html));

  const runPrint = (target: Window) => {
    target.focus();
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
    const closeFallback = window.setTimeout(safeClosePrintWindow, 45_000);
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

type ThermalPrintShell = {
  heading: string;
  pageTitle?: string;
  bodyClass?: string;
  styles: string;
  bodyInnerHtml: string;
};

async function openThermalPrintDocument(shell: ThermalPrintShell): Promise<void> {
  const logoSrc = await resolveBrandLogoDataUrlForPrint();
  const brand = buildThermalBrandBlockHtml(shell.heading, logoSrc);
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=302"/><title>${escapeHtml(shell.pageTitle ?? shell.heading)}</title>
<style>${shell.styles}</style></head><body${shell.bodyClass ? ` class="${shell.bodyClass}"` : ''}>
  ${brand}
  ${shell.bodyInnerHtml}
</body></html>`;
  openAndPrintHtml(html, THERMAL_80MM_WINDOW_FEATURES);
}

/** Ticket 80mm para impresora térmica (contenido en ventana dedicada). */
export function printThermalTicket(payload: TicketPayload): void {
  void printThermalTicketImpl(payload);
}

async function printThermalTicketImpl(payload: TicketPayload): Promise<void> {
  const negocio = payload.negocio || 'SERVIPARTZ';
  const logoSrc = await resolveBrandLogoDataUrlForPrint();
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
</style></head><body class="ticket-venta">
  ${buildThermalBrandBlockHtml(negocio, logoSrc)}
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
        ? `<div style="margin-top:3px;font-size:10px;font-weight:700;color:#92400e;">Saldo pendiente (cuenta cliente): ${formatMoney(payload.adeudoPendiente)}</div>`
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
  ${buildThermalPieSucursalHtml(payload.sucursalId)}
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
          return `<div class="ticket-barcode-wrap"><img src="${escapeHtml(src)}" alt="" /></div>`;
        })()
      : ''
  }
  <p class="ticket-gracias">${escapeHtml(payload.pieMensaje ?? '¡Gracias por su compra!')}</p>
</body></html>`;

  openAndPrintHtml(html, 'width=360,height=720');
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
      (it) => `<tr><td colspan="2" style="font-weight:600;padding-top:3px;">${escapeHtml(it.nombre.slice(0, 42))}</td></tr>
      <tr><td>SKU ${escapeHtml(it.sku)}</td><td class="right">Ex. ${it.existencia} / mín ${it.existenciaMinima}</td></tr>`
    )
    .join('');
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  void openThermalPrintDocument({
    heading: 'STOCK BAJO',
    pageTitle: 'Stock bajo',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}<br/>${input.items.length} artículo(s)</div>
  <table>${rows || '<tr><td>Sin artículos bajo mínimo.</td></tr>'}</table>
  ${pie}`,
  });
}

/** Lista de artículos de la misión diaria para conteo manual en papel (80 mm). */
export function printThermalDailyMission(input: {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  articulos: { nombre: string; sku: string; existencia: number; codigoBarras?: string }[];
}): void {
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const rows =
    input.articulos.length > 0 ?
      input.articulos
        .map((it, idx) => {
          const cb = it.codigoBarras?.trim() ? ` · CB ${escapeHtml(it.codigoBarras.trim())}` : '';
          return `<div class="ticket-mision-item">
  <div class="mision-nombre">${idx + 1}. ${escapeHtml(it.nombre.slice(0, 44))}</div>
  <div>SKU ${escapeHtml(it.sku)}${cb}</div>
  <div>En sistema: ${it.existencia}</div>
  <div class="mision-fisico">Físico: ________</div>
</div>`;
        })
        .join('')
    : '<p class="ticket-body-text">Sin artículos en la misión actual.</p>';
  void openThermalPrintDocument({
    heading: 'MISIÓN DIARIA',
    pageTitle: 'Misión diaria',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}<br/>Cajero: ${cajero}<br/>${input.articulos.length} artículo(s)</div>
  <p class="ticket-body-text">Conteo manual: anote la cantidad física y luego regístrela en el sistema.</p>
  ${rows}
  ${pie}`,
  });
}

/** Confirmación de misión de inventario completada (80 mm). */
export function printThermalMissionComplete(input: {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  articulosRevisados: number;
  totalEnMision: number;
}): void {
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  void openThermalPrintDocument({
    heading: 'MISIÓN COMPLETADA',
    pageTitle: 'Misión completada',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}<br/>Cajero: ${cajero}</div>
  <p class="ticket-body-text" style="font-weight:600;">
    Revisados en esta misión: <strong>${input.articulosRevisados}</strong> / ${input.totalEnMision}
  </p>
  <p class="ticket-body-text">Comprobante de que terminó la tarea de conteo o verificación asignada.</p>
  ${pie}`,
  });
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
            `<div class="ticket-mov-block">
  <div class="mov-tipo">${escapeHtml(it.tipoLabel)}</div>
  <div class="mov-linea">${escapeHtml(it.linea1.slice(0, 48))}</div>
  <div>${escapeHtml(it.linea2)}</div>
</div>`
        )
        .join('')
    : '<p class="ticket-body-text">Sin movimientos de inventario este día (para este usuario).</p>';
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  void openThermalPrintDocument({
    heading: 'INVENTARIO · DÍA',
    pageTitle: 'Movimientos inventario',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}<br/>Cajero: ${cajero}<br/>${input.movimientos.length} movimiento(s)</div>
  ${rows}
  ${pie}`,
  });
}

/** Comprobante de abono a cuenta por cobrar (80 mm). */
export type ThermalClientAbonoReceiptInput = {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  clienteNombre: string;
  montoAbono: number;
  formaPago?: string;
  saldoAnterior: number;
  saldoNuevo: number;
  /** Segundo ticket con leyenda orientada al cliente. */
  copiaCliente?: boolean;
};

export function printThermalClientAbonoReceipt(input: ThermalClientAbonoReceiptInput): void {
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const cliente = input.clienteNombre.trim() ? escapeHtml(input.clienteNombre.trim()) : 'Cliente';
  const saldoNuevo = Math.max(0, Number(input.saldoNuevo) || 0);
  const copia = Boolean(input.copiaCliente);
  const rolTitulo = copia ? 'COPIA CLIENTE' : 'TIENDA';
  const notaPie = copia ?
    'Conserve este comprobante como respaldo de su pago.'
  : 'Comprobante de archivo interno. Entregue copia al cliente si corresponde.';
  const formaLabel = input.formaPago
    ? escapeHtml(labelFormaPagoCaja(input.formaPago))
    : '';
  void openThermalPrintDocument({
    heading: 'COMPROBANTE DE ABONO',
    pageTitle: 'Comprobante de abono',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="ticket-rol">(${escapeHtml(rolTitulo)})</div>
  <div class="meta">
    ${escapeHtml(input.fechaLabel)}<br/>
    Cliente: ${cliente}<br/>
    Cajero: ${cajero}
  </div>
  <div class="tot abono-saldos">
    <div>Saldo anterior: ${formatMoney(Number(input.saldoAnterior) || 0)}</div>
    <div>Abono recibido: ${formatMoney(Number(input.montoAbono) || 0)}</div>
    ${formaLabel ? `<div>Forma de pago: ${formaLabel}</div>` : ''}
    <div class="abono-saldo-actual">Saldo actual: ${formatMoney(saldoNuevo)}</div>
  </div>
  <p class="abono-nota">${escapeHtml(notaPie)}</p>
  ${pie}`,
  });
}

/** Resumen de ventas para cierre de turno / día — formato ticket térmico 80 mm. */
export function printThermalDailySalesReport(input: {
  fechaLabel: string;
  sucursalId?: string;
  ventas: Sale[];
  /** Abonos CxC cobrados ese día (con forma de pago) — se reflejan el día del pago. */
  abonosCobros?: CajaAbonoCobro[];
  /** Si se indica, atribuye cobros de tickets a esa sesión. */
  cajaSesionId?: string;
}): void {
  const list = [...input.ventas].sort(
    (a, b) => saleFechaHistorial(a).getTime() - saleFechaHistorial(b).getTime()
  );
  const abonos = input.abonosCobros ?? [];
  const sid = input.cajaSesionId?.trim() || undefined;
  const movimientos = buildHistorialCobrosMovimientos(list, abonos).sort(
    (a, b) => a.at.getTime() - b.at.getTime()
  );
  const rows = movimientos
    .map((mov) => {
      if (mov.kind === 'abono') {
        const cliente = mov.abono.clienteNombre?.trim() || 'Cliente';
        const forma = labelFormaPagoCaja(mov.abono.formaPago);
        const cajero = mov.abono.usuarioNombre?.trim();
        const meta = cajero ? `${cliente} · ${forma} · ${cajero}` : `${cliente} · ${forma}`;
        return `<tr><td>Abono saldo pend.<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">${escapeHtml(meta)}</span></td><td class="right">${formatMoney(mov.monto)}</td></tr>`;
      }
      const v = mov.sale;
      const st =
        v.estado === 'cancelada' ?
          v.cancelacionMotivo === 'devolucion' ? ' (dev.)'
          : ' (cancel.)'
        : v.estado === 'pendiente' ? ' (abierta)'
        : '';
      const cliente = nombreClienteVenta(v);
      const cajero = nombreCajeroVenta(v);
      const meta = cajero ? `${cliente} · ${cajero}` : cliente;
      return `<tr><td>${escapeHtml(v.folio)}${st}<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">${escapeHtml(meta)}</span></td><td class="right">${formatMoney(Number(v.total) || 0)}</td></tr>`;
    })
    .join('');

  const cobrado = computeCobradoPeriodo(
    list.filter((v) => v.estado !== 'cancelada' && v.estado !== 'pendiente'),
    abonos,
    sid
  );
  const grupos = resumenGruposMedioPagoCierre(
    list.filter((v) => v.estado !== 'cancelada' && v.estado !== 'pendiente'),
    abonos,
    sid
  );
  const porForma = totalesPorFormaPago(
    list.filter((v) => v.estado !== 'cancelada' && v.estado !== 'pendiente'),
    abonos,
    sid
  );
  const formaRows = Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([clave, m]) =>
        `<tr><td>${escapeHtml(labelFormaPagoCaja(clave))}</td><td class="right">${formatMoney(Number(m) || 0)}</td></tr>`
    )
    .join('');

  const completadasDia = list.filter((v) => v.estado === 'completada' || v.estado === 'facturada');
  const totalAdeudoDia = completadasDia.reduce((s, v) => s + computeSaleClienteAdeudo(v), 0);
  const adeudoRedondeado = Math.round(totalAdeudoDia * 100) / 100;
  const adeudoStyle = adeudoRedondeado > 0.004 ? 'color:#92400e;' : '';
  const ticketsCount = list.filter((v) => v.estado !== 'cancelada').length;

  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  void openThermalPrintDocument({
    heading: 'REPORTE VENTAS',
    pageTitle: 'Reporte ventas',
    bodyClass: 'ticket-cierre-turno',
    styles: THERMAL_CIERRE_TURNO_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}<br/>${ticketsCount} ticket(s)${abonos.length ? ` · ${abonos.length} abono(s)` : ''} · ${cobrado.movimientos} cobro(s)</div>
  <table>${rows || '<tr><td>Sin movimientos.</td></tr>'}</table>
  <div class="tot" style="border-top:none;padding-top:4px;">
    <div><strong>Resumen medios</strong> <span style="font-size:${THERMAL_MIN_FONT_PX}px;">(cobrado del día)</span></div>
    <div>Efectivo: ${formatMoney(grupos.efectivoCobros)}</div>
    <div>Tarjetas: ${formatMoney(grupos.tarjetas)}</div>
    <div>Otros: ${formatMoney(grupos.otros)}</div>
  </div>
  <p class="ticket-section-title">Cobros por forma de pago</p>
  <table>${formaRows || '<tr><td>Sin cobros registrados</td></tr>'}</table>
  <div class="tot"><strong>Total cobrado: ${formatMoney(cobrado.cobradoTotal)}</strong><br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">Ventas del día + abonos cobrados hoy (criterio de caja)</span>${
    cobrado.cobradoAbonos > 0.005
      ? `<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">Abonos: ${formatMoney(cobrado.cobradoAbonos)}</span>`
      : ''
  }</div>
  <div class="tot" style="border-top:none;padding-top:4px;">
    <div><strong>Saldo pendiente por cobrar (día)</strong></div>
    <div style="font-size:11px;font-weight:700;${adeudoStyle}">${formatMoney(adeudoRedondeado)}</div>
    <span style="font-size:${THERMAL_MIN_FONT_PX}px;">Lo que quedó por cobrar en ventas del día (parciales / crédito). Si es $0.00, no hubo adeudos.</span>
  </div>
  ${pie}`,
  });
}

/** Comprobante de emisión de crédito de tienda (80 mm). */
export type ThermalClientCreditoReceiptInput = {
  fechaLabel: string;
  sucursalId?: string;
  cajeroNombre?: string;
  clienteNombre: string;
  montoCredito: number;
  saldoAnterior: number;
  saldoNuevo: number;
  motivoLabel?: string;
  notas?: string;
  copiaCliente?: boolean;
};

export function printThermalClientCreditoReceipt(input: ThermalClientCreditoReceiptInput): void {
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  const cajero = input.cajeroNombre?.trim() ? escapeHtml(input.cajeroNombre.trim()) : '—';
  const cliente = input.clienteNombre.trim() ? escapeHtml(input.clienteNombre.trim()) : 'Cliente';
  const saldoNuevo = Math.max(0, Number(input.saldoNuevo) || 0);
  const copia = Boolean(input.copiaCliente);
  const rolTitulo = copia ? 'COPIA CLIENTE' : 'TIENDA';
  const motivo = input.motivoLabel?.trim() ? escapeHtml(input.motivoLabel.trim()) : 'Crédito de tienda';
  const notasExtra = input.notas?.trim() ? `<div>Notas: ${escapeHtml(input.notas.trim())}</div>` : '';
  const notaPie = copia
    ? 'Conserve este comprobante. Válido para compras en tienda (crédito de tienda).'
    : 'Comprobante interno. Entregue copia al cliente.';
  void openThermalPrintDocument({
    heading: 'CRÉDITO DE TIENDA',
    pageTitle: 'Crédito de tienda',
    bodyClass: 'ticket-compact',
    styles: THERMAL_COMPACT_SHELL_STYLES,
    bodyInnerHtml: `<div class="ticket-rol">(${escapeHtml(rolTitulo)})</div>
  <div class="meta">
    ${escapeHtml(input.fechaLabel)}<br/>
    Cliente: ${cliente}<br/>
    Cajero: ${cajero}<br/>
    Motivo: ${motivo}
  </div>
  ${notasExtra}
  <div class="tot abono-saldos">
    <div>Saldo anterior: ${formatMoney(Number(input.saldoAnterior) || 0)}</div>
    <div>Crédito otorgado: ${formatMoney(Number(input.montoCredito) || 0)}</div>
    <div class="abono-saldo-actual">Saldo disponible: ${formatMoney(saldoNuevo)}</div>
  </div>
  <p class="abono-nota">${escapeHtml(notaPie)}</p>
  ${pie}`,
  });
}

export type ThermalClientStatusReportInput = {
  fechaLabel: string;
  sucursalId?: string;
  client: Pick<Client, 'nombre' | 'rfc' | 'email' | 'telefono'>;
  stats: {
    totalCompras: number;
    totalGastado: number;
    saldoPendiente: number;
    numFacturas: number;
    numCotizaciones: number;
    numAdeudos: number;
    totalAbonado: number;
  };
  ventasRecientes: { folio: string; total: number; fecha: string; estado: string }[];
  facturasRecientes: { folioSerie: string; total: number; fecha: string; estado: string }[];
  cotizacionesRecientes: { folio: string; total: number; fecha: string; estado: string }[];
};

/** Estado de cuenta del cliente — ticket térmico 80 mm. */
export function printThermalClientStatusReport(input: ThermalClientStatusReportInput): void {
  const c = input.client;
  const st = input.stats;
  const saldoStyle = st.saldoPendiente > 0.004 ? 'color:#92400e;font-weight:700;' : 'color:#166534;font-weight:700;';
  const saldoLabel = st.saldoPendiente > 0.004 ? 'Saldo pendiente' : 'Al corriente';

  const ventasRows = input.ventasRecientes
    .slice(0, 12)
    .map(
      (v) =>
        `<tr><td>${escapeHtml(v.folio)}<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">${escapeHtml(v.fecha)} · ${escapeHtml(v.estado)}</span></td><td class="right">${formatMoney(v.total)}</td></tr>`
    )
    .join('');

  const factRows = input.facturasRecientes
    .slice(0, 8)
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.folioSerie)}<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">${escapeHtml(f.fecha)} · ${escapeHtml(f.estado)}</span></td><td class="right">${formatMoney(f.total)}</td></tr>`
    )
    .join('');

  const cotRows = input.cotizacionesRecientes
    .slice(0, 8)
    .map(
      (q) =>
        `<tr><td>${escapeHtml(q.folio)}<br/><span style="font-size:${THERMAL_MIN_FONT_PX}px;">${escapeHtml(q.fecha)} · ${escapeHtml(q.estado)}</span></td><td class="right">${formatMoney(q.total)}</td></tr>`
    )
    .join('');

  const pie = buildThermalPieSucursalHtml(input.sucursalId);
  void openThermalPrintDocument({
    heading: 'ESTADO DE CLIENTE',
    pageTitle: 'Estado de cliente',
    bodyClass: 'ticket-cierre-turno',
    styles: THERMAL_CIERRE_TURNO_STYLES,
    bodyInnerHtml: `<div class="meta">${escapeHtml(input.fechaLabel)}</div>
  <div class="tot" style="border-top:none;padding-top:2px;">
    <div><strong>${escapeHtml(c.nombre)}</strong></div>
    ${c.rfc?.trim() ? `<div>RFC: ${escapeHtml(c.rfc.trim())}</div>` : ''}
    ${c.telefono?.trim() ? `<div>Tel: ${escapeHtml(c.telefono.trim())}</div>` : ''}
    ${c.email?.trim() ? `<div>${escapeHtml(c.email.trim())}</div>` : ''}
  </div>
  <div class="tot">
    <div>Compras: <strong>${st.totalCompras}</strong></div>
    <div>Total gastado: <strong>${formatMoney(st.totalGastado)}</strong></div>
    <div>Facturas: <strong>${st.numFacturas}</strong> · Cotizaciones: <strong>${st.numCotizaciones}</strong></div>
    <div>Tickets con adeudo: <strong>${st.numAdeudos}</strong></div>
    ${st.totalAbonado > 0.004 ? `<div>Abonos registrados: <strong>${formatMoney(st.totalAbonado)}</strong></div>` : ''}
    <div style="margin-top:4px;">${saldoLabel}: <span style="${saldoStyle}">${formatMoney(st.saldoPendiente)}</span></div>
  </div>
  <p class="ticket-section-title">Últimas compras</p>
  <table>${ventasRows || '<tr><td>Sin compras.</td></tr>'}</table>
  <p class="ticket-section-title">Facturas</p>
  <table>${factRows || '<tr><td>Sin facturas.</td></tr>'}</table>
  <p class="ticket-section-title">Cotizaciones</p>
  <table>${cotRows || '<tr><td>Sin cotizaciones.</td></tr>'}</table>
  <p class="abono-nota">Documento informativo sin valor fiscal. Sujeto a conciliación con Cuentas por cobrar.</p>
  ${pie}`,
  });
}

/** Línea de aporte/retiro en ticket 80 mm: monto y hora en una línea; concepto (notas) aparte para que no se corte. */
function thermalCajaMovimientoLineHtml(
  kind: 'aporte' | 'retiro',
  r: CajaAporteEfectivo | CajaRetiroEfectivo
): string {
  const sign = kind === 'aporte' ? '+' : '−';
  const hora = formatInAppTimezone(r.createdAt, { timeStyle: 'short' });
  const concepto = r.notas?.trim();
  const line1 = `<div style="font-size:10px;margin:2px 0 0;line-height:1.2;">
    <span style="font-weight:700;">${sign}${escapeHtml(formatMoney(r.monto))}</span>
    <span> · ${escapeHtml(hora)} · ${escapeHtml(r.usuarioNombre)}</span>
  </div>`;
  const line2 = concepto
    ? `<div style="font-size:${THERMAL_MIN_FONT_PX}px;margin:0 0 3px;line-height:1.15;font-weight:700;">${escapeHtml(concepto)}</div>`
    : `<div style="margin-bottom:2px;"></div>`;
  return line1 + line2;
}

/** Comprobante de cierre de turno (sesión) o arqueo previo — ticket térmico 80 mm. */
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
  /** Abonos CxC cobrados en la sesión (cuentan en medios de pago del corte). */
  abonosCobros?: CajaAbonoCobro[];
  /** Si se indica, los cobros de tickets se atribuyen a esta sesión (día del pago). */
  cajaSesionId?: string;
  tarjetasEsperadas?: number;
  conteoTarjetasDeclarado?: number;
  diferenciaTarjetas?: number;
  cierresTerminal?: CajaCierreTerminal[];
  /** `arqueo_previo`: sin conteo físico ni diferencia; título distinto. */
  ticketKind?: 'cierre' | 'arqueo_previo';
}): void {
  const abonos = input.abonosCobros;
  const sid = input.cajaSesionId?.trim() || undefined;
  const grupos = resumenGruposMedioPagoCierre(input.ventas, abonos, sid);
  const porForma = totalesPorFormaPago(input.ventas, abonos, sid);
  const formaRows = Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([clave, m]) =>
        `<tr><td>${escapeHtml(labelFormaPagoCaja(clave))}</td><td class="right">${formatMoney(Number(m) || 0)}</td></tr>`
    )
    .join('');
  const pie = buildThermalPieSucursalHtml(input.sucursalId);
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
    const rows = sorted.map((r) => thermalCajaMovimientoLineHtml('aporte', r)).join('');
    return `<div class="ticket-section-title">Detalle aportes</div>${rows}`;
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
    const rows = sorted.map((r) => thermalCajaMovimientoLineHtml('retiro', r)).join('');
    return `<div class="ticket-section-title">Detalle retiros</div>${rows}`;
  })();
  const abonosLista = (() => {
    const list = input.abonosCobros;
    if (!list?.length) return '';
    const sorted = [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const rows = sorted
      .map((a) => {
        const cliente = a.clienteNombre?.trim() ? escapeHtml(a.clienteNombre.trim()) : 'Cliente';
        return `<div>+${formatMoney(Number(a.monto) || 0)} · ${escapeHtml(labelFormaPagoCaja(a.formaPago))} · ${cliente}</div>`;
      })
      .join('');
    return `<div class="ticket-section-title">Abonos CxC (sesión)</div>${rows}`;
  })();

  const tarjetasEsperadasPrint =
    input.tarjetasEsperadas != null ? Number(input.tarjetasEsperadas) : grupos.tarjetas;
  const bloqueTerminal = (() => {
    if (esArqueo) return '';
    const list = input.cierresTerminal;
    const declarado =
      input.conteoTarjetasDeclarado != null
        ? Number(input.conteoTarjetasDeclarado)
        : list?.length
          ? Math.round(list.reduce((s, c) => s + (Number(c.total) || 0), 0) * 100) / 100
          : null;
    if (declarado == null && !list?.length) return '';
    const dif =
      input.diferenciaTarjetas != null
        ? Number(input.diferenciaTarjetas)
        : declarado != null
          ? Math.round((declarado - tarjetasEsperadasPrint) * 100) / 100
          : null;
    const sorted = list?.length
      ? [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      : [];
    const rows = sorted
      .map(
        (c) =>
          `<div>Folio ${escapeHtml(c.folio)}: ${formatMoney(Number(c.total) || 0)}</div>`
      )
      .join('');
    return `<div class="tot" style="border-top:none;padding-top:4px;">
    <div><strong>Cierres de terminal</strong></div>
    <div>Tarjetas POS: ${formatMoney(tarjetasEsperadasPrint)}</div>
    ${declarado != null ? `<div>Total corte declarado: ${formatMoney(declarado)}</div>` : ''}
    ${dif != null ? `<div>Diferencia tarjetas: ${formatMoney(dif)}</div>` : ''}
    ${rows ? `<div class="ticket-section-title">Vouchers</div>${rows}` : ''}
  </div>`;
  })();

  void openThermalPrintDocument({
    heading: titulo,
    pageTitle: titulo,
    bodyClass: 'ticket-cierre-turno',
    styles: THERMAL_CIERRE_TURNO_STYLES,
    bodyInnerHtml: `<div class="meta">
    ${escapeHtml(input.fechaLabel)}<br/>
    Apertura: ${escapeHtml(input.aperturaLabel)} · ${escapeHtml(input.abiertaPor)}<br/>
    ${metaCierre}
  </div>
  <div class="tot" style="border-top:none;padding-top:4px;">
    <div>Fondo inicial: ${formatMoney(input.fondoInicial)}</div>
    <div>Tickets cobrados: ${input.ticketsCompletados}</div>
    <div>Venta neta (completadas): ${formatMoney(input.totalVentasBruto)}</div>
  </div>
  <div class="tot" style="border-top:none;padding-top:4px;">
    <div><strong>Resumen medios</strong></div>
    <div>Efectivo: ${formatMoney(grupos.efectivoCobros)}</div>
    <div>Tarjetas: ${formatMoney(grupos.tarjetas)}</div>
    <div>Otros: ${formatMoney(grupos.otros)}</div>
  </div>
  <p class="ticket-section-title">Cobros por forma de pago</p>
  <table>${formaRows || '<tr><td>Sin cobros registrados</td></tr>'}</table>
  <div class="tot">
    <div><strong>Efectivo esperado en caja</strong></div>
    ${aportes}
    ${aportesLista}
    ${retiros}
    ${retirosLista}
    ${abonosLista}
    <div style="font-size:11px;"><strong>${formatMoney(input.efectivoEsperado)}</strong></div>
    ${bloqueConteo}
  </div>
  ${bloqueTerminal}
  ${pie}`,
  });
}

/** Texto estándar para documentos que no son válidos ante el SAT. */
export const AVISO_DOC_FISCAL_PRUEBA =
  'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL ANTE EL SAT';

/** HTML completo tamaño carta (impresión, vista previa o PDF). */
export function buildLetterDocumentHtml(
  title: string,
  innerHtml: string,
  options?: { sucursalId?: string | null; avisoPrueba?: string }
): string {
  const head = buildLetterHeaderHtml();
  const foot = buildLetterFooterHtml(options?.sucursalId);
  const aviso =
    options?.avisoPrueba != null && options.avisoPrueba !== ''
      ? `<div class="aviso-prueba">${escapeHtml(options.avisoPrueba)}</div>`
      : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  /* Mismo criterio de márgenes / ancho útil que la representación impresa CFDI (factura). */
  @page { size: letter; margin: 7mm 11mm 9mm 11mm; }
  * { box-sizing: border-box; }
  html { height: 100%; }
  body.letter-doc {
    font-family: system-ui, sans-serif;
    font-size: 11pt;
    color: #111;
    line-height: 1.4;
    margin: 0 auto;
    max-width: 7.5in;
    padding: 0;
    min-height: 1056px;
    display: flex;
    flex-direction: column;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .letter-doc-main {
    flex: 1 1 auto;
    min-height: 0;
  }
  .doc-brand-head {
    flex-shrink: 0;
    text-align: center;
    margin: -4px 0 10px;
    padding: 0 0 10px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-brand-head img {
    display: inline-block;
    max-width: min(70px, 22vw);
    height: auto;
    object-fit: contain;
    vertical-align: top;
  }
  .doc-brand-head .doc-brand-title {
    margin-top: 6px;
    font-size: 15pt;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .doc-brand-foot {
    flex-shrink: 0;
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 9pt;
    line-height: 1.45;
    color: #334155;
    text-align: center;
  }
  @media print {
    body.letter-doc {
      min-height: 10.25in;
    }
  }
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
</style></head><body class="letter-doc">
${head}
<div class="letter-doc-main">
<h1>${escapeHtml(title)}</h1>
${aviso}
${innerHtml}
</div>
${foot}
</body></html>`;
}

/** Documento tamaño carta (facturas / cotizaciones) en ventana de impresión. */
export function printLetterDocument(
  title: string,
  innerHtml: string,
  options?: { sucursalId?: string | null; avisoPrueba?: string }
): void {
  const html = buildLetterDocumentHtml(title, innerHtml, options);
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
