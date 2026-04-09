import { buildLetterFooterHtml, getBrandLogoAbsoluteUrl } from '@/lib/documentPrintBranding';
import { montoALetrasMXN } from '@/lib/montoALetras';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { formatMoney } from '@/lib/utils';
import {
  buildInvoiceCfdiQrUrl,
  buildSatVerificacionCfdiUrl,
  CFDI_MUESTRA_UUID,
} from '@/lib/satVerificacionCfdi';
import { buildCfdi40XmlString } from '@/lib/cfdiXmlString';
import { openCfdiLetterPrint } from '@/lib/openLetterPrint';
import {
  CLAVES_UNIDAD,
  FORMAS_PAGO,
  REGIMENES_FISCALES,
  USOS_CFDI,
  type FiscalConfig,
  type Invoice,
} from '@/types';

const AVISO_FISCAL_PRUEBA = 'DOCUMENTO DE PRUEBA - SIN VALIDEZ FISCAL ANTE EL SAT';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function regimenLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '-';
  const r = REGIMENES_FISCALES.find((x) => x.clave === clave);
  return r ? `${escHtml(r.clave)} - ${escHtml(r.descripcion)}` : escHtml(clave);
}

function usoCfdiLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '-';
  const u = USOS_CFDI.find((x) => x.clave === clave);
  return u ? `${escHtml(u.clave)} - ${escHtml(u.descripcion)}` : escHtml(clave);
}

function formaPagoLabel(clave: string | undefined): string {
  if (!clave?.trim()) return '-';
  const f = FORMAS_PAGO.find((x) => x.clave === clave);
  return f ? `${escHtml(f.clave)} - ${escHtml(f.descripcion)}` : escHtml(clave);
}

/** Una línea tipo factura impresa (mayúsculas): calle, colonia, CP, tel., municipio/estado. */
function buildDireccionClassica(emisor: FiscalConfig): string {
  const d = emisor.direccion;
  const parts: string[] = [];
  if (d?.calle?.trim()) {
    let line = d.calle.trim();
    if (d.numeroExterior?.trim()) line += ` No. ${d.numeroExterior.trim()}`;
    if (d.numeroInterior?.trim()) line += ` Int. ${d.numeroInterior.trim()}`;
    parts.push(line);
  }
  if (d?.colonia?.trim()) parts.push(`COL. ${d.colonia.trim()}`);
  const cp = d?.codigoPostal?.trim() || emisor.lugarExpedicion?.trim();
  if (cp) parts.push(`C.P. ${cp}`);
  if (emisor.telefono?.trim()) parts.push(`TEL: ${emisor.telefono.trim()}`);
  const munEst = [d?.municipio, d?.estado].filter(Boolean).join(' ');
  if (munEst) parts.push(munEst);
  if (d?.pais?.trim() && d.pais.trim().toLowerCase() !== 'méxico' && d.pais.trim().toLowerCase() !== 'mexico') {
    parts.push(d.pais.trim());
  }
  if (parts.length === 0 && cp) parts.push(`C.P. ${cp}`);
  return parts.join(' ').toUpperCase() || '-';
}

/** «Ciudad, Estado a 8 de abril de 2026» (zona horaria de la app). */
function buildLugarFechaEmisionLinea(emisor: FiscalConfig, fechaEmision: Date): string {
  const d = emisor.direccion;
  const city = d?.municipio?.trim() || d?.ciudad?.trim() || '';
  const estado = d?.estado?.trim() || '';
  const lug = city && estado ? `${city}, ${estado}` : city || estado || 'México';
  const fechaLarga = formatInAppTimezone(fechaEmision, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${lug} a ${fechaLarga}`;
}

/** Clave SAT corta en tabla (ahorra alto en carta). */
function unidadCortaSat(clave: string | undefined): string {
  const c = (clave || 'H87').trim();
  const u = CLAVES_UNIDAD.find((x) => x.clave === c);
  return u ? `${u.clave}` : c;
}

const FACTURA_PRINT_STYLES = `
@page { size: letter; margin: 9mm 11mm; }
* { box-sizing: border-box; }
body {
  font-family: Arial, Helvetica, 'Liberation Sans', sans-serif;
  font-size: 7.5pt;
  color: #000;
  line-height: 1.38;
  margin: 0 auto;
  max-width: 7.5in;
  padding: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.aviso-prueba {
  margin: 0 0 8px;
  padding: 6px 8px;
  border: 1.5px solid #b45309;
  background: #fffbeb;
  color: #92400e;
  font-weight: 700;
  font-size: 7.25pt;
  text-align: center;
  line-height: 1.35;
}
.hdr-logo {
  flex: 0 0 62px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}
.hdr-logo img {
  display: block;
  width: 58px;
  height: 58px;
  object-fit: contain;
}
.hdr-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 8px; }
.hdr-emisor { flex: 1; min-width: 0; padding-right: 4px; }
.rfc-line { font-size: 9.5pt; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.02em; }
.nombre-emisor { font-size: 8.25pt; font-weight: 700; margin-bottom: 5px; line-height: 1.32; }
.addr-line { font-size: 7pt; text-transform: uppercase; line-height: 1.4; word-wrap: break-word; }
.lugar-fecha { font-size: 7.35pt; margin-top: 10px; font-weight: 600; line-height: 1.35; }
.folio-caja { flex: 0 0 120px; border: 2px solid #000; text-align: center; padding: 7px 6px; }
.folio-caja .tit { font-size: 10.5pt; font-weight: 800; letter-spacing: 0.1em; }
.folio-caja .meta { font-size: 6pt; margin-top: 5px; line-height: 1.35; font-weight: 600; }
.folio-caja .fl { margin-top: 7px; font-size: 7.75pt; font-weight: 700; line-height: 1.3; }
.folio-caja .fl-valor { font-weight: 800; }
.folio-caja .fl-valor.prueba { color: #c00; }
.ley-apocrifa { font-size: 6.25pt; text-align: center; margin: 8px 0 8px; font-style: italic; line-height: 1.4; }
.cliente-box { margin-bottom: 8px; }
.cliente-box .row { display: flex; align-items: baseline; gap: 8px; margin: 5px 0; font-size: 7.65pt; border-bottom: 1px solid #000; padding-bottom: 5px; min-height: 1.15em; }
.cliente-box .row .k { font-weight: 700; flex: 0 0 auto; }
.cliente-box .row .v { flex: 1; min-width: 0; }
.meta-rec {
  display: grid;
  grid-template-columns: minmax(7.5em, max-content) 1fr;
  column-gap: 12px;
  row-gap: 6px;
  align-items: start;
  font-size: 6.85pt;
  color: #111;
  margin-top: 8px;
  padding: 8px 10px;
  line-height: 1.4;
  background: #f9fafb;
  border: 1px solid #ccc;
  border-radius: 2px;
}
.meta-rec .mk { font-weight: 700; }
.meta-rec .mv { word-wrap: break-word; hyphens: auto; }
table.clasica { width: 100%; border-collapse: collapse; margin: 8px 0 10px; font-size: 7pt; table-layout: fixed; }
table.clasica th, table.clasica td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; line-height: 1.35; }
table.clasica th { font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; font-size: 6.5pt; padding: 6px 6px; }
table.clasica col.c-qty { width: 9%; }
table.clasica col.c-u { width: 11%; }
table.clasica col.c-desc { width: 48%; }
table.clasica col.c-pu { width: 15%; }
table.clasica col.c-imp { width: 17%; }
table.clasica .num { text-align: right; white-space: nowrap; }
table.clasica .cps { font-size: 6pt; color: #333; }
table.clasica tbody tr.filler td { height: 1.1em; padding-top: 4px; padding-bottom: 4px; }
.pie-grid { display: flex; gap: 12px; align-items: stretch; margin-top: 8px; }
.pie-izq { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.pie-der { flex: 0 0 208px; }
.caja-total-letra { border: 1px solid #000; padding: 7px 9px; font-size: 7pt; min-height: 2.6em; line-height: 1.38; }
.caja-total-letra strong { display: block; margin-bottom: 5px; font-size: 6.25pt; text-transform: uppercase; letter-spacing: 0.04em; }
.aduanero-sicofi { font-size: 6pt; font-style: italic; line-height: 1.38; margin: 0; }
.qr-xml-row { display: flex; gap: 12px; align-items: flex-start; margin-top: 4px; }
.qr-zona { flex: 0 0 auto; }
.qr-zona img { display: block; }
.qr-caption { font-size: 5.75pt; margin-top: 5px; max-width: 100px; line-height: 1.3; text-align: center; }
.xml-panel {
  flex: 1;
  min-width: 0;
  border: 1px solid #000;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  max-height: 128px;
}
.xml-panel .xml-hdr {
  font-size: 6.1pt;
  font-weight: 700;
  padding: 5px 7px;
  background: #e5e5e5;
  border-bottom: 1px solid #000;
  text-transform: uppercase;
  line-height: 1.35;
}
.xml-panel pre {
  margin: 0;
  padding: 7px 8px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 5.6pt;
  line-height: 1.22;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  flex: 1;
  max-height: 104px;
}
.pago-caja { border: 1px solid #000; padding: 7px 10px; font-size: 7.35pt; font-weight: 700; text-align: center; line-height: 1.35; }
.tot-wrap { border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt; height: 100%; }
.tot-line { display: flex; justify-content: space-between; gap: 10px; margin: 5px 0; padding: 2px 0; font-size: 8pt; line-height: 1.35; }
.tot-line.gran { border-top: 3px double #000; margin-top: 10px; padding-top: 8px; font-weight: 800; font-size: 10.5pt; }
.vigencia { font-size: 6pt; margin: 10px 0 6px; line-height: 1.42; text-align: justify; }
.cfdi-nota { font-size: 6pt; color: #333; margin: 0; line-height: 1.4; }
.sellos { margin-top: 8px; font-size: 5.15pt; word-break: break-all; color: #111; border-top: 1px solid #888; padding-top: 8px; line-height: 1.38; }
.sellos .lbl { font-weight: 700; font-size: 5.75pt; margin-top: 8px; }
.sellos .lbl:first-child { margin-top: 0; }
.sellos .muestra-tag { font-weight: 600; color: #666; }
.sellos .mono { font-family: Consolas, 'Courier New', monospace; line-height: 1.42; }
body .doc-brand-foot { margin-top: 10px !important; padding-top: 6px !important; font-size: 5.75pt !important; line-height: 1.38 !important; }
@media print {
  html, body {
    font-family: Arial, Helvetica, sans-serif !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .xml-panel pre,
  .sellos .mono {
    font-family: "Courier New", Courier, monospace !important;
  }
}
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

  const qrUrlReal =
    inv.uuid && inv.selloDigital
      ? buildSatVerificacionCfdiUrl({
          uuid: inv.uuid,
          rfcEmisor: emisor.rfc,
          rfcReceptor: rfcRec,
          total: inv.total,
          selloDigitalEmisor: inv.selloDigital,
        })
      : null;
  const brandLogoUrl = escHtml(getBrandLogoAbsoluteUrl());
  const qrEsMuestra = !qrUrlReal;
  const qrUrl = buildInvoiceCfdiQrUrl(inv);

  let qrBlock: string;
  if (qrUrl) {
    const QRCode = (await import('qrcode')).default;
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      width: 92,
      margin: 0,
      errorCorrectionLevel: 'M',
    });
    const cap = qrEsMuestra
      ? 'Formato verificacion SAT (muestra). El portal no validara este UUID hasta timbrar.'
      : 'Verificacion SAT (CBB).';
    qrBlock = `<div class="qr-zona"><img src="${dataUrl}" width="92" height="92" alt="QR CFDI" /><div class="qr-caption">${escHtml(cap)}</div></div>`;
  } else {
    qrBlock = `<div class="qr-zona"><div class="qr-caption">${escHtml('Sin RFC emisor no se puede generar el QR.')}</div></div>`;
  }

  const xmlFull = buildCfdi40XmlString(inv);
  const xmlMax = 2600;
  const xmlCut =
    xmlFull.length > xmlMax
      ? `${xmlFull.slice(0, xmlMax)}\n<!-- ...continua; descargue el XML completo... -->`
      : xmlFull;
  const xmlExcerptHtml = escHtml(xmlCut);

  const productos = inv.productos ?? [];
  const rowsConceptos = productos
    .map((it) => {
      const desc = (it.descripcion || '').trim() || '-';
      const cps = (it.claveProdServ || '01010101').trim();
      const cu = (it.claveUnidad || 'H87').trim();
      const cpsNote =
        cps !== '01010101' ? ` <span class="cps">(${escHtml(cps)})</span>` : '';
      return `<tr>
        <td class="num">${escHtml(Number(it.cantidad).toFixed(2))}</td>
        <td>${escHtml(unidadCortaSat(cu))}</td>
        <td class="desc">${escHtml(desc)}${cpsNote}</td>
        <td class="num">${formatMoney(it.precioUnitario)}</td>
        <td class="num">${formatMoney(it.subtotal)}</td>
      </tr>`;
    })
    .join('');

  /** Pocas filas en blanco: solo relleno mínimo cuando hay muy pocos conceptos (evita media página vacía). */
  const filasOcupadas = productos.length > 0 ? productos.length : 1;
  const filasVacias =
    filasOcupadas >= 4 ? 0 : Math.min(1, Math.max(0, 3 - filasOcupadas));
  const filasRelleno = Array.from({ length: filasVacias }, () => {
    return '<tr class="filler"><td class="num">&nbsp;</td><td></td><td></td><td class="num"></td><td class="num"></td></tr>';
  }).join('');

  const aviso = inv.esPrueba
    ? `<div class="aviso-prueba">${escHtml(AVISO_FISCAL_PRUEBA)}</div>`
    : inv.estado !== 'timbrada'
      ? `<div class="aviso-prueba">CFDI sin timbrar - sin validez fiscal ante el SAT hasta timbrarlo con un PAC autorizado.</div>`
      : '';

  const addrClassica = escHtml(buildDireccionClassica(emisor));
  const lugarFechaLinea = escHtml(buildLugarFechaEmisionLinea(emisor, inv.fechaEmision));
  const folioValorClass = inv.esPrueba ? 'fl-valor prueba' : 'fl-valor';
  const metodoPagoTexto =
    inv.metodoPago === 'PPD' ? 'Pago en parcialidades o diferido' : 'Pago en una sola exhibición';

  const uuidLinea = inv.uuid?.trim()
    ? escHtml(inv.uuid)
    : `${escHtml(CFDI_MUESTRA_UUID)} <span class="muestra-tag">(muestra - sin timbrar)</span>`;

  const noCert = inv.certificado?.trim()
    ? `<div class="sellos" style="border-top:none;padding-top:2px;margin-top:2px;"><div class="lbl">No. de serie del CSD del emisor</div><div class="mono">${escHtml(inv.certificado!.slice(0, 72))}${inv.certificado!.length > 72 ? '…' : ''}</div></div>`
    : `<div class="sellos" style="border-top:none;padding-top:2px;margin-top:2px;"><div class="lbl">No. de serie del CSD del emisor <span class="muestra-tag">(muestra)</span></div><div class="mono">${escHtml('00001000000405225812')}</div></div>`;

  const cadenaMostrar =
    inv.cadenaOriginal && inv.cadenaOriginal.length > 320
      ? `${inv.cadenaOriginal.slice(0, 320)}…`
      : inv.cadenaOriginal;

  const selloSatBlock =
    inv.estado === 'timbrada' && inv.selloDigital
      ? `<div class="sellos">
          <div class="lbl">Sello digital del emisor</div>
          <div class="mono">${escHtml(inv.selloDigital.slice(0, 180))}${inv.selloDigital.length > 180 ? '…' : ''}</div>
          ${cadenaMostrar ? `<div class="lbl">Cadena original (SAT)</div><div class="mono">${escHtml(cadenaMostrar)}</div>` : ''}
        </div>`
      : `<div class="sellos">
          <div class="lbl">Sello digital del emisor <span class="muestra-tag">(PAC de prueba - no valido SAT)</span></div>
          <div class="mono">${escHtml('||D3M0P4CPRU3B4S3LL0D1G1T4LD3L3M1S0RXXXXXXXXXXXXXXXXXXXXXXXXXXXX||')}</div>
          <div class="lbl">Sello digital del SAT <span class="muestra-tag">(muestra)</span></div>
          <div class="mono">${escHtml('||S4T0000000000000000000000000000000000000000000000000000000000000000||')}</div>
          <div class="lbl">Cadena original del complemento de certificación <span class="muestra-tag">(extracto)</span></div>
          <div class="mono">${escHtml(`||4.0|${inv.serie}|${inv.folio}|${inv.total.toFixed(2)}|${emisor.rfc}|${rfcRec}||`)}</div>
        </div>`;

  const inner = `
${aviso}
<div class="hdr-row">
  <div class="hdr-logo"><img src="${brandLogoUrl}" alt="SERVIPARTZ" /></div>
  <div class="hdr-emisor">
    <div class="rfc-line">RFC: ${escHtml(emisor.rfc)}</div>
    <div class="nombre-emisor">${escHtml(emisor.nombreComercial?.trim() || emisor.razonSocial || '-')}</div>
    <div class="addr-line">${addrClassica}</div>
    <div class="lugar-fecha">${lugarFechaLinea}</div>
  </div>
  <div class="folio-caja">
    <div class="tit">FACTURA</div>
    <div class="meta">CFDI 4.0 | Tipo I | Moneda MXN</div>
    <div class="fl">Folio: <span class="${folioValorClass}">${escHtml(inv.serie)} ${escHtml(inv.folio)}</span></div>
  </div>
</div>

<p class="ley-apocrifa">La reproducción apócrifa de este comprobante constituye un delito en los términos de las disposiciones fiscales.</p>

<div class="cliente-box">
  <div class="row"><span class="k">NOMBRE:</span><span class="v">${escHtml(nombreRec)}</span></div>
  <div class="row"><span class="k">RFC CLIENTE:</span><span class="v">${escHtml(rfcRec)}</span></div>
  <div class="meta-rec">
    <span class="mk">C.P.</span><span class="mv">${escHtml(cpRec || '-')}</span>
    <span class="mk">Régimen fiscal</span><span class="mv">${regimenLabel(regRec)}</span>
    <span class="mk">Uso CFDI</span><span class="mv">${usoCfdiLabel(uso)}</span>
    <span class="mk">Lugar de expedición</span><span class="mv">${escHtml(inv.lugarExpedicion || emisor.lugarExpedicion || '-')}</span>
    <span class="mk">Fecha y hora de emisión</span><span class="mv">${escHtml(formatInAppTimezone(inv.fechaEmision, { dateStyle: 'full', timeStyle: 'short' }))}</span>
  </div>
</div>

<table class="clasica">
  <colgroup>
    <col class="c-qty" /><col class="c-u" /><col class="c-desc" /><col class="c-pu" /><col class="c-imp" />
  </colgroup>
  <thead>
    <tr>
      <th class="num">Cantidad</th>
      <th>Unidad de medida</th>
      <th>Descripción</th>
      <th class="num">P. unitario</th>
      <th class="num">Importe</th>
    </tr>
  </thead>
  <tbody>${rowsConceptos || `<tr><td colspan="5" class="desc">Sin conceptos</td></tr>`}${filasRelleno}</tbody>
</table>

<div class="pie-grid">
  <div class="pie-izq">
    <div class="caja-total-letra"><strong>Total con letra</strong><br/>${escHtml(montoALetrasMXN(inv.total))}</div>
    <p class="aduanero-sicofi">NUMERO Y FECHA DE DOCUMENTO ADUANERO: ______ (solo importacion 1a. mano) | NUMERO DE APROBACION SICOFI: ______</p>
    <div class="qr-xml-row">
      ${qrBlock}
      <div class="xml-panel">
        <div class="xml-hdr">Vista previa XML CFDI 4.0 (mismo contenido que el archivo .xml)</div>
        <pre>${xmlExcerptHtml}</pre>
      </div>
    </div>
    <div class="pago-caja">${escHtml(metodoPagoTexto)}</div>
    <p class="cfdi-nota">Forma de pago: ${formaPagoLabel(inv.formaPago)}. ${inv.esPrueba || inv.estado !== 'timbrada' ? 'Sin validez fiscal hasta timbrar con PAC; el QR usa formato del SAT solo como demostracion.' : 'CFDI timbrado: valide el XML y el portal del SAT.'}</p>
  </div>
  <div class="pie-der">
    <div class="tot-wrap">
      <div class="tot-line"><span>SUBTOTAL</span><span>${formatMoney(inv.subtotal)}</span></div>
      <div class="tot-line"><span>DESCUENTO</span><span>${formatMoney(inv.descuento)}</span></div>
      <div class="tot-line"><span>IVA</span><span>${formatMoney(inv.impuestosTrasladados)}</span></div>
      <div class="tot-line gran"><span>TOTAL</span><span>${formatMoney(inv.total)}</span></div>
    </div>
  </div>
</div>

<p class="vigencia">Este comprobante tendrá una vigencia de dos años contando a partir de la fecha de aprobación de la asignación de folios, la cual es: __/__/____</p>
<div class="sellos">
  <div class="lbl">Folio fiscal (UUID)</div>
  <div class="mono">${uuidLinea}</div>
</div>
${noCert}
${selloSatBlock}
`;

  const foot = buildLetterFooterHtml(inv.sucursalId ?? null);
  const title = `Factura ${inv.serie}-${inv.folio}`;

  return `<!DOCTYPE html><html lang="es-MX"><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<title>${escHtml(title)}</title>
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

/** Datos del trabajador en el recibo de nómina (prueba / representación impresa). */
export type NominaPruebaReceptor = {
  nombre: string;
  rfc: string;
  numeroEmpleado: string;
  curp: string;
  departamento: string;
  puesto: string;
};

export type NominaPruebaPeriodo = {
  /** Texto libre, p. ej. «1 al 15 de marzo 2026». */
  descripcion: string;
  diasPagados: string;
  /** p. ej. «O (ordinaria)». */
  tipoNomina: string;
};

export type NominaPruebaLineaPercepcion = {
  clave: string;
  concepto: string;
  gravado: number;
  exento: number;
};

export type NominaPruebaLineaDeduccion = {
  clave: string;
  concepto: string;
  importe: number;
};

/** Borrador completo editable desde Configuración (recibo de prueba). */
export type NominaPruebaDraftForm = {
  receptor: NominaPruebaReceptor;
  periodo: NominaPruebaPeriodo;
  percepciones: NominaPruebaLineaPercepcion[];
  deducciones: NominaPruebaLineaDeduccion[];
};

export const NOMINA_PRUEBA_DEFAULTS: NominaPruebaDraftForm = {
  receptor: {
    nombre: 'MARÍA FICTICIA PÉREZ GARCÍA',
    rfc: 'XAXX010101000',
    numeroEmpleado: '001',
    curp: 'XXXX000000HDFXXX00',
    departamento: 'Operaciones',
    puesto: 'Auxiliar administrativo',
  },
  periodo: {
    descripcion: '1 al 15 de marzo 2026',
    diasPagados: '15',
    tipoNomina: 'O (ordinaria)',
  },
  percepciones: [
    { clave: '001', concepto: 'Sueldos, salarios y jornales', gravado: 8500, exento: 0 },
    { clave: '038', concepto: 'Bono de desempeño', gravado: 500, exento: 0 },
  ],
  deducciones: [
    { clave: '002', concepto: 'ISR', importe: 1240 },
    { clave: '021', concepto: 'IMSS', importe: 285 },
  ],
};

export function getNominaPruebaDraftDefaults(): NominaPruebaDraftForm {
  return {
    receptor: { ...NOMINA_PRUEBA_DEFAULTS.receptor },
    periodo: { ...NOMINA_PRUEBA_DEFAULTS.periodo },
    percepciones: NOMINA_PRUEBA_DEFAULTS.percepciones.map((r) => ({ ...r })),
    deducciones: NOMINA_PRUEBA_DEFAULTS.deducciones.map((r) => ({ ...r })),
  };
}

/** Entrada para impresión de recibo de nómina (vista previa / prueba). */
export type NominaPruebaPrintInput = {
  config: FiscalConfig;
  serie: string;
  folio: string;
  sucursalId?: string | null;
  receptor?: Partial<NominaPruebaReceptor>;
  periodo?: Partial<NominaPruebaPeriodo>;
  percepciones?: NominaPruebaLineaPercepcion[];
  deducciones?: NominaPruebaLineaDeduccion[];
};

function mergeNominaPruebaInput(input: NominaPruebaPrintInput): NominaPruebaDraftForm {
  const base = getNominaPruebaDraftDefaults();
  const receptor = { ...base.receptor, ...input.receptor };
  const periodo = { ...base.periodo, ...input.periodo };
  const percepciones =
    input.percepciones && input.percepciones.length > 0
      ? input.percepciones.map((r) => ({
          clave: r.clave ?? '',
          concepto: r.concepto ?? '',
          gravado: Number(r.gravado) || 0,
          exento: Number(r.exento) || 0,
        }))
      : base.percepciones;
  const deducciones =
    input.deducciones && input.deducciones.length > 0
      ? input.deducciones.map((r) => ({
          clave: r.clave ?? '',
          concepto: r.concepto ?? '',
          importe: Number(r.importe) || 0,
        }))
      : base.deducciones;
  return { receptor, periodo, percepciones, deducciones };
}

const NOMINA_ONE_PAGE_STYLES = `
@page { size: letter; margin: 5mm 7mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; line-height: 1.22; color: #111; margin: 0; }
.brand-top { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 6px; }
.brand-top .brand-logo { width: 54px; height: 54px; object-fit: contain; flex: 0 0 54px; }
.brand-top .brand-title { font-size: 9pt; font-weight: 700; letter-spacing: 0.03em; margin-top: 4px; }
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
  const draft = mergeNominaPruebaInput(input);
  const { receptor, periodo, percepciones, deducciones } = draft;

  const totalPercepciones = percepciones.reduce(
    (s, p) => s + (Number(p.gravado) || 0) + (Number(p.exento) || 0),
    0
  );
  const totalDeducciones = deducciones.reduce((s, d) => s + (Number(d.importe) || 0), 0);
  const neto = totalPercepciones - totalDeducciones;

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
  const brandLogoUrl = escHtml(getBrandLogoAbsoluteUrl());

  const rowsPercep = percepciones
    .map(
      (p) =>
        `<tr><td>${escHtml(p.clave)}</td><td>${escHtml(p.concepto)}</td><td class="num">${formatMoney(p.gravado)}</td><td class="num">${formatMoney(p.exento)}</td></tr>`
    )
    .join('');

  const rowsDed = deducciones
    .map(
      (d) =>
        `<tr><td>${escHtml(d.clave)}</td><td>${escHtml(d.concepto)}</td><td class="num">${formatMoney(d.importe)}</td></tr>`
    )
    .join('');

  const inner = `
<div class="aviso-prueba">${escHtml(AVISO_FISCAL_PRUEBA)}</div>
<div class="brand-top">
  <img class="brand-logo" src="${brandLogoUrl}" alt="SERVIPARTZ" />
  <div class="brand-title">SERVIPARTZ</div>
</div>
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
    <h3>Receptor (trabajador)</h3>
    <div><strong>Nombre:</strong> ${escHtml(receptor.nombre)}</div>
    <div><strong>RFC:</strong> ${escHtml(receptor.rfc)}</div>
    <div><strong>Núm. empleado:</strong> ${escHtml(receptor.numeroEmpleado)} · <strong>CURP:</strong> ${escHtml(receptor.curp)}</div>
    <div><strong>Depto. / Puesto:</strong> ${escHtml(receptor.departamento)} · ${escHtml(receptor.puesto)}</div>
  </div>
</div>

<p class="periodo"><strong>Periodo de pago:</strong> ${escHtml(periodo.descripcion)} &nbsp;|&nbsp; <strong>Días pagados:</strong> ${escHtml(periodo.diasPagados)} &nbsp;|&nbsp; <strong>Tipo:</strong> ${escHtml(periodo.tipoNomina)}</p>

<div class="tables-2">
  <div>
    <strong style="font-size:7pt;">Percepciones</strong>
    <table class="mini">
      <thead><tr><th>Clave</th><th>Concepto</th><th class="num">Gravado</th><th class="num">Exento</th></tr></thead>
      <tbody>
        ${rowsPercep || `<tr><td colspan="4">—</td></tr>`}
      </tbody>
    </table>
  </div>
  <div>
    <strong style="font-size:7pt;">Deducciones</strong>
    <table class="mini">
      <thead><tr><th>Clave</th><th>Concepto</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${rowsDed || `<tr><td colspan="3">—</td></tr>`}
      </tbody>
    </table>
  </div>
</div>

<div class="tot">
  <div>Total percepciones: ${formatMoney(totalPercepciones)}</div>
  <div>Total deducciones: ${formatMoney(totalDeducciones)}</div>
  <div><strong>Neto a pagar: ${formatMoney(neto)}</strong></div>
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
