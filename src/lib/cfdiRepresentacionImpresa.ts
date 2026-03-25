import { buildLetterFooterHtml } from '@/lib/documentPrintBranding';
import { montoALetrasMXN } from '@/lib/montoALetras';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { formatMoney } from '@/lib/utils';
import { buildSatVerificacionCfdiUrl } from '@/lib/satVerificacionCfdi';
import { openCfdiLetterPrint } from '@/lib/openLetterPrint';
import {
  CLAVES_UNIDAD,
  FORMAS_PAGO,
  REGIMENES_FISCALES,
  USOS_CFDI,
  type FiscalConfig,
  type Invoice,
  type InvoiceItem,
} from '@/types';

const AVISO_FISCAL_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL ANTE EL SAT';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function regimenLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '—';
  const r = REGIMENES_FISCALES.find((x) => x.clave === clave);
  return r ? `${escHtml(r.clave)} — ${escHtml(r.descripcion)}` : escHtml(clave);
}

function usoCfdiLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '—';
  const u = USOS_CFDI.find((x) => x.clave === clave);
  return u ? `${escHtml(u.clave)} — ${escHtml(u.descripcion)}` : escHtml(clave);
}

function formaPagoLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '—';
  const f = FORMAS_PAGO.find((x) => x.clave === clave);
  return f ? `${escHtml(f.clave)} — ${escHtml(f.descripcion)}` : escHtml(clave);
}

function unidadLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '—';
  const u = CLAVES_UNIDAD.find((x) => x.clave === clave);
  return u ? escHtml(`${u.clave} (${u.descripcion})`) : escHtml(clave);
}

function domicilioFiscalTexto(emisor: FiscalConfig): string {
  const d = emisor.direccion;
  if (!d) return emisor.lugarExpedicion ? `C.P. ${escHtml(emisor.lugarExpedicion)}` : '—';
  const parts = [
    d.calle,
    d.numeroExterior ? `# ${d.numeroExterior}` : '',
    d.numeroInterior ? `Int. ${d.numeroInterior}` : '',
    d.colonia,
    d.codigoPostal ? `C.P. ${d.codigoPostal}` : '',
    d.ciudad || d.municipio,
    d.estado,
    d.pais,
  ].filter(Boolean);
  return escHtml(parts.join(', '));
}

function lineaIva(item: InvoiceItem): number {
  return item.impuestosTrasladados?.reduce((s, t) => s + (t.importe || 0), 0) ?? 0;
}

const FACTURA_PRINT_STYLES = `
@page { size: letter; margin: 10mm 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #111; line-height: 1.35; margin: 0; }
.aviso-prueba {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 2px solid #b45309;
  background: #fffbeb;
  color: #92400e;
  font-weight: 700;
  font-size: 8.5pt;
  text-align: center;
}
.grid-top { display: grid; grid-template-columns: 1fr 200px; gap: 12px; align-items: start; margin-bottom: 10px; }
.emisor-nombre { font-weight: 700; font-size: 11pt; margin-bottom: 4px; }
.emisor-lines { font-size: 8.5pt; }
.folio-box { border: 2px solid #111; text-align: center; padding: 8px 6px; }
.folio-box .tipo { font-size: 14pt; font-weight: 800; letter-spacing: 0.06em; }
.folio-box .sf { font-size: 10pt; font-weight: 700; margin-top: 4px; }
.folio-box .uuid { font-size: 6.5pt; word-break: break-all; margin-top: 6px; text-align: left; }
.receptor { border: 1px solid #333; padding: 8px; margin-bottom: 10px; font-size: 8.5pt; }
.receptor strong { display: block; margin-bottom: 4px; font-size: 9pt; }
table.conceptos { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-bottom: 10px; }
table.conceptos th, table.conceptos td { border: 1px solid #333; padding: 4px 3px; vertical-align: top; }
table.conceptos th { background: #f1f5f9; font-weight: 600; }
.num { text-align: right; white-space: nowrap; }
.footer-split { display: grid; grid-template-columns: 1fr 160px; gap: 12px; align-items: start; }
.total-letra { font-size: 8pt; font-weight: 600; margin-bottom: 6px; border: 1px solid #333; padding: 6px; }
.pago-info { font-size: 8pt; margin-bottom: 8px; }
.qr-wrap { margin-top: 8px; text-align: left; }
.qr-wrap img { display: block; }
.qr-placeholder {
  border: 1px dashed #64748b;
  padding: 8px;
  font-size: 7.5pt;
  color: #475569;
  max-width: 200px;
}
.totales { border: 1px solid #333; padding: 8px; font-size: 9pt; }
.totales div { display: flex; justify-content: space-between; margin: 3px 0; }
.totales .grand { font-weight: 800; font-size: 11pt; border-top: 1px solid #333; margin-top: 6px; padding-top: 6px; }
.leyenda { font-size: 6.5pt; color: #444; margin-top: 8px; line-height: 1.35; max-width: 320px; }
.sellos { margin-top: 12px; font-size: 5.5pt; word-break: break-all; color: #333; border-top: 1px solid #ccc; padding-top: 8px; }
.sellos .lbl { font-weight: 700; font-size: 6pt; margin-top: 6px; }
`;

export async function buildInvoiceCfdiPrintDocumentHtml(inv: Invoice): Promise<string> {
  const emisor = inv.emisor;
  const rfcRec = (inv.cliente?.rfc || 'XAXX010101000').trim().toUpperCase();
  const nombreRec =
    inv.cliente?.razonSocial?.trim() ||
    inv.cliente?.nombre?.trim() ||
    'Público en General';
  const cpRec =
    inv.cliente?.codigoPostal?.trim() ||
    inv.cliente?.direccion?.codigoPostal?.trim() ||
    inv.lugarExpedicion;
  const uso = inv.cliente?.usoCfdi || 'S01';
  const regRec = inv.cliente?.regimenFiscal || '616';

  const qrUrl =
    inv.uuid && emisor?.rfc
      ? buildSatVerificacionCfdiUrl({
          uuid: inv.uuid,
          rfcEmisor: emisor.rfc,
          rfcReceptor: rfcRec,
          total: inv.total,
          selloDigitalEmisor: inv.selloDigital,
        })
      : null;

  let qrBlock: string;
  if (qrUrl) {
    const QRCode = (await import('qrcode')).default;
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      width: 132,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    qrBlock = `<div class="qr-wrap"><img src="${dataUrl}" width="132" height="132" alt="QR SAT" /><div style="font-size:6.5pt;margin-top:4px;">Verificación SAT (CBB)</div></div>`;
  } else {
    qrBlock = `<div class="qr-placeholder">Código bidimensional (CBB): se genera cuando el CFDI está timbrado ante el SAT (UUID y sello digital del emisor). Este documento ${inv.esPrueba ? 'es de prueba' : 'no incluye timbre'}.</div>`;
  }

  const productos = inv.productos ?? [];
  const rows = productos
    .map((it) => {
      const desc = (it.descripcion || '').trim() || '—';
      const cps = (it.claveProdServ || '01010101').trim();
      const cu = (it.claveUnidad || 'H87').trim();
      const ivaL = lineaIva(it);
      return `<tr>
        <td>${escHtml(cps)}</td>
        <td>${unidadLabel(cu)}</td>
        <td class="num">${escHtml(String(it.cantidad))}</td>
        <td>${escHtml(desc)}</td>
        <td class="num">${formatMoney(it.precioUnitario)}</td>
        <td class="num">${formatMoney(it.descuento || 0)}</td>
        <td class="num">${formatMoney(ivaL)}</td>
        <td class="num">${formatMoney(it.total)}</td>
      </tr>`;
    })
    .join('');

  const aviso = inv.esPrueba
    ? `<div class="aviso-prueba">${escHtml(AVISO_FISCAL_PRUEBA)}</div>`
    : inv.estado !== 'timbrada'
      ? `<div class="aviso-prueba">CFDI sin timbrar — sin validez fiscal ante el SAT hasta timbrarlo con un PAC autorizado.</div>`
      : '';

  const nombreEmisorMostrar =
    emisor.nombreComercial?.trim() || emisor.razonSocial || 'Emisor';

  const uuidHtml = inv.uuid
    ? `<div class="uuid"><strong>Folio fiscal:</strong><br/>${escHtml(inv.uuid)}</div>`
    : `<div class="uuid"><strong>Folio fiscal:</strong> Pendiente de asignación al timbrar</div>`;

  const noCert = inv.certificado?.trim()
    ? `<div class="uuid" style="margin-top:4px;"><strong>No. serie CSD emisor:</strong><br/>${escHtml(inv.certificado!.slice(0, 64))}${inv.certificado!.length > 64 ? '…' : ''}</div>`
    : '';

  const cadenaMostrar =
    inv.cadenaOriginal && inv.cadenaOriginal.length > 600
      ? `${inv.cadenaOriginal.slice(0, 600)}…`
      : inv.cadenaOriginal;

  const selloSatBlock =
    inv.estado === 'timbrada' && inv.selloDigital
      ? `<div class="sellos">
          <div class="lbl">Sello digital del CFDI (emisor)</div>
          <div>${escHtml(inv.selloDigital)}</div>
          ${cadenaMostrar ? `<div class="lbl">Cadena original del complemento de certificación digital del SAT</div><div>${escHtml(cadenaMostrar)}</div>` : ''}
        </div>`
      : `<div class="sellos"><div class="lbl">Sello digital y cadena original del SAT</div><div>Se mostrarán íntegramente en el CFDI timbrado por su PAC.</div></div>`;

  const inner = `
${aviso}
<div class="grid-top">
  <div>
    <div class="emisor-nombre">${escHtml(nombreEmisorMostrar)}</div>
    <div class="emisor-lines">
      <div><strong>RFC:</strong> ${escHtml(emisor.rfc)}</div>
      <div><strong>Régimen fiscal:</strong> ${regimenLabel(emisor.regimenFiscal)}</div>
      <div><strong>Domicilio fiscal:</strong> ${domicilioFiscalTexto(emisor)}</div>
      <div><strong>Lugar de expedición:</strong> ${escHtml(inv.lugarExpedicion || emisor.lugarExpedicion || '—')}</div>
    </div>
  </div>
  <div class="folio-box">
    <div class="tipo">FACTURA</div>
    <div class="sf">Serie ${escHtml(inv.serie)} &nbsp; Folio ${escHtml(inv.folio)}</div>
    ${uuidHtml}
    ${noCert}
    <div class="uuid" style="margin-top:6px;"><strong>Fecha y hora de emisión:</strong><br/>${escHtml(formatInAppTimezone(inv.fechaEmision, { dateStyle: 'full', timeStyle: 'short' }))}</div>
  </div>
</div>

<div class="receptor">
  <strong>Receptor</strong>
  <div><strong>Nombre:</strong> ${escHtml(nombreRec)}</div>
  <div><strong>RFC:</strong> ${escHtml(rfcRec)}</div>
  <div><strong>Domicilio fiscal (C.P.):</strong> ${escHtml(cpRec || '—')}</div>
  <div><strong>Régimen fiscal del receptor:</strong> ${regimenLabel(regRec)}</div>
  <div><strong>Uso CFDI:</strong> ${usoCfdiLabel(uso)}</div>
</div>

<table class="conceptos">
  <thead>
    <tr>
      <th>Clave prod/serv</th>
      <th>Unidad</th>
      <th class="num">Cant.</th>
      <th>Descripción</th>
      <th class="num">Valor unit.</th>
      <th class="num">Desc.</th>
      <th class="num">IVA trasl.</th>
      <th class="num">Importe</th>
    </tr>
  </thead>
  <tbody>${rows || `<tr><td colspan="8">Sin conceptos</td></tr>`}</tbody>
</table>

<div class="footer-split">
  <div>
    <div class="total-letra"><strong>TOTAL CON LETRA:</strong> ${escHtml(montoALetrasMXN(inv.total))}</div>
    <div class="pago-info"><strong>Forma de pago:</strong> ${formaPagoLabel(inv.formaPago)}<br/>
    <strong>Método de pago:</strong> ${inv.metodoPago === 'PPD' ? 'PPD — Pago en parcialidades o diferido' : 'PUE — Pago en una sola exhibición'}</div>
    ${qrBlock}
    <p class="leyenda">Este documento es una representación impresa de un CFDI 4.0. La validez fiscal ante el SAT la otorga el XML timbrado (UUID, sellos y cadena original). Cualquier discrepancia debe resolverse con el archivo XML y la verificación en el portal del SAT.</p>
  </div>
  <div class="totales">
    <div><span>Subtotal</span><span>${formatMoney(inv.subtotal)}</span></div>
    <div><span>Descuento</span><span>${formatMoney(inv.descuento)}</span></div>
    <div><span>IVA trasladado</span><span>${formatMoney(inv.impuestosTrasladados)}</span></div>
    <div class="grand"><span>TOTAL</span><span>${formatMoney(inv.total)}</span></div>
  </div>
</div>
${selloSatBlock}
`;

  const foot = buildLetterFooterHtml(inv.sucursalId ?? null);
  const title = `Factura ${inv.serie}-${inv.folio}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escHtml(title)}</title>
<style>${FACTURA_PRINT_STYLES}</style></head><body>
${inner}
${foot}
</body></html>`;
}

export function printInvoiceCfdiRepresentacion(inv: Invoice): void {
  void (async () => {
    try {
      const html = await buildInvoiceCfdiPrintDocumentHtml(inv);
      openCfdiLetterPrint(html);
    } catch (e) {
      console.error('printInvoiceCfdiRepresentacion', e);
    }
  })();
}

/** Entrada para impresión de recibo de nómina (vista previa / prueba). */
export type NominaPruebaPrintInput = {
  config: FiscalConfig;
  serie: string;
  folio: string;
  sucursalId?: string | null;
};

const NOMINA_ONE_PAGE_STYLES = `
@page { size: letter; margin: 5mm 7mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; line-height: 1.22; color: #111; margin: 0; }
h1 { font-size: 11pt; margin: 0 0 4px; }
.meta { font-size: 7.5pt; margin-bottom: 6px; }
.aviso-prueba {
  margin: 0 0 6px;
  padding: 4px 6px;
  border: 1.5px solid #b45309;
  background: #fffbeb;
  color: #92400e;
  font-weight: 700;
  font-size: 7pt;
  text-align: center;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-bottom: 6px; }
.box { border: 1px solid #333; padding: 5px 6px; font-size: 7pt; }
.box h3 { margin: 0 0 3px; font-size: 7.5pt; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
.periodo { font-size: 7pt; margin: 2px 0 6px; }
.tables-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
table.mini { width: 100%; border-collapse: collapse; font-size: 6.75pt; }
table.mini th, table.mini td { border: 1px solid #444; padding: 2px 3px; }
table.mini th { background: #eef2f7; }
.num { text-align: right; }
.tot { margin-top: 6px; font-size: 8pt; border: 1px solid #333; padding: 5px 8px; display: inline-block; min-width: 220px; }
.tot strong { font-size: 9pt; }
.muted { font-size: 6.5pt; color: #444; margin-top: 6px; line-height: 1.3; }
@media print {
  .grid-2, .tables-2, .tot { break-inside: avoid; page-break-inside: avoid; }
}
`;

export function buildNominaPruebaPrintDocumentHtml(input: NominaPruebaPrintInput): string {
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

  const foot = buildLetterFooterHtml(input.sucursalId ?? null);

  const inner = `
<div class="aviso-prueba">${escHtml(AVISO_FISCAL_PRUEBA)}</div>
<h1>Recibo de nómina</h1>
<p class="meta"><strong>Serie:</strong> ${escHtml(serie)} &nbsp;|&nbsp; <strong>Folio:</strong> ${escHtml(folio)} &nbsp;|&nbsp; <strong>Fecha:</strong> ${escHtml(fecha)} &nbsp;|&nbsp; <strong>Tipo:</strong> Nómina (CFDI 4.0 — representación impresa)</p>

<div class="grid-2">
  <div class="box">
    <h3>Emisor</h3>
    <div><strong>RFC:</strong> ${escHtml(config.rfc)}</div>
    <div><strong>Razón social:</strong> ${escHtml(config.razonSocial)}</div>
    <div><strong>Régimen fiscal:</strong> ${escHtml(config.regimenFiscal)}</div>
    <div><strong>Lugar expedición:</strong> ${escHtml(cp)}</div>
    ${domicilioEmisor ? `<div><strong>Domicilio:</strong> ${escHtml(domicilioEmisor)}</div>` : ''}
  </div>
  <div class="box">
    <h3>Receptor (ejemplo)</h3>
    <div><strong>Nombre:</strong> MARÍA FICTICIA PÉREZ GARCÍA</div>
    <div><strong>RFC:</strong> XAXX010101000</div>
    <div><strong>Núm. empleado:</strong> 001 · <strong>CURP:</strong> XXXX000000HDFXXX00</div>
    <div><strong>Depto. / Puesto:</strong> Operaciones · Auxiliar administrativo</div>
  </div>
</div>

<p class="periodo"><strong>Periodo de pago:</strong> 1 al 15 de marzo 2026 (ejemplo) &nbsp;|&nbsp; <strong>Días pagados:</strong> 15 &nbsp;|&nbsp; <strong>Tipo:</strong> O (ordinaria)</p>

<div class="tables-2">
  <div>
    <strong style="font-size:7pt;">Percepciones</strong>
    <table class="mini">
      <thead><tr><th>Clave</th><th>Concepto</th><th class="num">Gravado</th><th class="num">Exento</th></tr></thead>
      <tbody>
        <tr><td>001</td><td>Sueldos, salarios y jornales</td><td class="num">${formatMoney(8500)}</td><td class="num">${formatMoney(0)}</td></tr>
        <tr><td>038</td><td>Bono de desempeño</td><td class="num">${formatMoney(500)}</td><td class="num">${formatMoney(0)}</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <strong style="font-size:7pt;">Deducciones</strong>
    <table class="mini">
      <thead><tr><th>Clave</th><th>Concepto</th><th class="num">Importe</th></tr></thead>
      <tbody>
        <tr><td>002</td><td>ISR</td><td class="num">${formatMoney(1240)}</td></tr>
        <tr><td>021</td><td>IMSS</td><td class="num">${formatMoney(285)}</td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="tot">
  <div>Total percepciones: ${formatMoney(9000)}</div>
  <div>Total deducciones: ${formatMoney(1525)}</div>
  <div><strong>Neto a pagar: ${formatMoney(7475)}</strong></div>
</div>

<p class="muted">
  Representación impresa orientada al formato de recibo de nómina electrónica (CFDI con complemento). La validez fiscal ante el SAT requiere XML generado con el complemento de nómina, sellado con CSD y <strong>timbrado por un PAC autorizado</strong> (UUID, sellos digitales y código bidimensional conforme a las reglas del SAT).
</p>
`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Recibo de nómina</title>
<style>${NOMINA_ONE_PAGE_STYLES}</style></head><body>
${inner}
${foot}
</body></html>`;
}

export function printNominaPruebaCfdiLetter(input: NominaPruebaPrintInput): void {
  const html = buildNominaPruebaPrintDocumentHtml(input);
  openCfdiLetterPrint(html);
}
