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
  return parts.join(' ').toUpperCase() || '—';
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

function unidadMedidaFactura(clave: string | undefined): string {
  const c = (clave || 'H87').trim();
  const u = CLAVES_UNIDAD.find((x) => x.clave === c);
  return u ? `${u.clave} — ${u.descripcion}` : c;
}

const FACTURA_PRINT_STYLES = `
@page { size: letter; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body {
  font-family: Arial, Helvetica, 'Liberation Sans', sans-serif;
  font-size: 8.5pt;
  color: #000;
  line-height: 1.25;
  margin: 0 auto;
  max-width: 7.35in;
  padding: 0 0 10px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.aviso-prueba {
  margin: 0 0 8px;
  padding: 6px 8px;
  border: 2px solid #b45309;
  background: #fffbeb;
  color: #92400e;
  font-weight: 700;
  font-size: 8pt;
  text-align: center;
}
.hdr-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 4px; }
.hdr-emisor { flex: 1; min-width: 0; }
.rfc-line { font-size: 11pt; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.03em; }
.nombre-emisor { font-size: 9.5pt; font-weight: 700; margin-bottom: 6px; line-height: 1.2; }
.addr-line { font-size: 8pt; text-transform: uppercase; line-height: 1.35; word-wrap: break-word; }
.lugar-fecha { font-size: 8.5pt; margin-top: 10px; font-weight: 600; }
.folio-caja { flex: 0 0 150px; border: 2px solid #000; text-align: center; padding: 10px 8px; }
.folio-caja .tit { font-size: 13pt; font-weight: 800; letter-spacing: 0.14em; }
.folio-caja .fl { margin-top: 10px; font-size: 9.5pt; font-weight: 700; }
.folio-caja .fl-valor { font-weight: 800; }
.folio-caja .fl-valor.prueba { color: #c00; }
.ley-apocrifa { font-size: 6.5pt; text-align: center; margin: 8px 0 10px; font-style: italic; }
.cliente-box { margin-bottom: 8px; }
.cliente-box .row { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; font-size: 9pt; border-bottom: 1px solid #000; padding-bottom: 3px; min-height: 1.25em; }
.cliente-box .row .k { font-weight: 700; flex: 0 0 auto; }
.cliente-box .row .v { flex: 1; min-width: 0; }
.meta-rec { font-size: 7pt; color: #111; margin-top: 6px; line-height: 1.35; }
table.clasica { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 8pt; }
table.clasica th, table.clasica td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; }
table.clasica th { font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 7.5pt; }
table.clasica .num { text-align: right; white-space: nowrap; }
table.clasica .cps { font-size: 6.5pt; color: #333; }
.pie-grid { display: flex; gap: 14px; align-items: flex-start; margin-top: 2px; }
.pie-izq { flex: 1.12; min-width: 0; }
.pie-der { flex: 0 0 40%; max-width: 248px; }
.caja-total-letra { border: 1px solid #000; padding: 6px 8px; margin-bottom: 8px; font-size: 8pt; min-height: 3.4em; }
.caja-total-letra strong { display: block; margin-bottom: 4px; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.06em; }
.aduanero { font-size: 6.5pt; font-style: italic; margin-bottom: 8px; line-height: 1.35; }
.qr-zona { margin: 6px 0; }
.qr-zona img { display: block; }
.qr-placeholder { border: 1px dashed #444; padding: 10px; font-size: 7pt; max-width: 176px; line-height: 1.3; }
.sicofi { font-size: 8pt; margin: 8px 0 4px; }
.pago-caja { border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt; font-weight: 700; text-align: center; margin-top: 8px; }
.tot-wrap { border: 1px solid #000; padding: 10px 12px; font-size: 9.5pt; }
.tot-line { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; padding: 2px 0; }
.tot-line.gran { border-top: 3px double #000; margin-top: 10px; padding-top: 8px; font-weight: 800; font-size: 11pt; }
.vigencia { font-size: 6.5pt; margin: 12px 0 6px; line-height: 1.4; text-align: justify; }
.cfdi-nota { font-size: 6.5pt; color: #333; margin-top: 8px; line-height: 1.35; max-width: 100%; }
.sellos { margin-top: 10px; font-size: 5.5pt; word-break: break-all; color: #222; border-top: 1px solid #999; padding-top: 8px; }
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
    qrBlock = `<div class="qr-zona"><img src="${dataUrl}" width="132" height="132" alt="QR SAT" /><div style="font-size:6.5pt;margin-top:4px;">Verificación SAT (CBB)</div></div>`;
  } else {
    qrBlock = `<div class="qr-zona qr-placeholder">Código bidimensional (CBB): se genera cuando el CFDI está timbrado ante el SAT (UUID y sello digital del emisor). Este documento ${inv.esPrueba ? 'es de prueba' : 'no incluye timbre'}.</div>`;
  }

  const productos = inv.productos ?? [];
  const rowsConceptos = productos
    .map((it) => {
      const desc = (it.descripcion || '').trim() || '—';
      const cps = (it.claveProdServ || '01010101').trim();
      const cu = (it.claveUnidad || 'H87').trim();
      const cpsNote =
        cps !== '01010101' ? ` <span class="cps">(${escHtml(cps)})</span>` : '';
      return `<tr>
        <td class="num">${escHtml(Number(it.cantidad).toFixed(2))}</td>
        <td>${escHtml(unidadMedidaFactura(cu))}</td>
        <td class="desc">${escHtml(desc)}${cpsNote}</td>
        <td class="num">${formatMoney(it.precioUnitario)}</td>
        <td class="num">${formatMoney(it.subtotal)}</td>
      </tr>`;
    })
    .join('');

  const MIN_FILAS_TABLA = 12;
  const filasOcupadas = productos.length > 0 ? productos.length : 1;
  const filasVacias = Math.max(0, MIN_FILAS_TABLA - filasOcupadas);
  const filasRelleno = Array.from({ length: filasVacias }, () => {
    return '<tr><td class="num">&nbsp;</td><td></td><td></td><td class="num"></td><td class="num"></td></tr>';
  }).join('');

  const aviso = inv.esPrueba
    ? `<div class="aviso-prueba">${escHtml(AVISO_FISCAL_PRUEBA)}</div>`
    : inv.estado !== 'timbrada'
      ? `<div class="aviso-prueba">CFDI sin timbrar — sin validez fiscal ante el SAT hasta timbrarlo con un PAC autorizado.</div>`
      : '';

  const addrClassica = escHtml(buildDireccionClassica(emisor));
  const lugarFechaLinea = escHtml(buildLugarFechaEmisionLinea(emisor, inv.fechaEmision));
  const folioValorClass = inv.esPrueba ? 'fl-valor prueba' : 'fl-valor';
  const metodoPagoTexto =
    inv.metodoPago === 'PPD' ? 'Pago en parcialidades o diferido' : 'Pago en una sola exhibición';

  const uuidBloque = inv.uuid
    ? `<div class="sellos" style="border-top:none;padding-top:4px;margin-top:6px;"><div class="lbl">Folio fiscal (UUID)</div><div>${escHtml(inv.uuid)}</div></div>`
    : '';

  const noCert = inv.certificado?.trim()
    ? `<div class="sellos" style="border-top:none;padding-top:0;margin-top:4px;"><div class="lbl">No. de serie del CSD del emisor</div><div>${escHtml(inv.certificado!.slice(0, 88))}${inv.certificado!.length > 88 ? '…' : ''}</div></div>`
    : '';

  const cadenaMostrar =
    inv.cadenaOriginal && inv.cadenaOriginal.length > 600
      ? `${inv.cadenaOriginal.slice(0, 600)}…`
      : inv.cadenaOriginal;

  const selloSatBlock =
    inv.estado === 'timbrada' && inv.selloDigital
      ? `<div class="sellos">
          <div class="lbl">Sello digital del emisor</div>
          <div>${escHtml(inv.selloDigital)}</div>
          ${cadenaMostrar ? `<div class="lbl">Cadena original del complemento de certificación digital del SAT</div><div>${escHtml(cadenaMostrar)}</div>` : ''}
        </div>`
      : `<div class="sellos"><div class="lbl">Sello digital y cadena original del SAT</div><div>Aparecerán en el XML timbrado por su PAC.</div></div>`;

  const inner = `
${aviso}
<div class="hdr-row">
  <div class="hdr-emisor">
    <div class="rfc-line">RFC: ${escHtml(emisor.rfc)}</div>
    <div class="nombre-emisor">${escHtml(emisor.nombreComercial?.trim() || emisor.razonSocial || '—')}</div>
    <div class="addr-line">${addrClassica}</div>
    <div class="lugar-fecha">${lugarFechaLinea}</div>
  </div>
  <div class="folio-caja">
    <div class="tit">FACTURA</div>
    <div class="fl">Folio: <span class="${folioValorClass}">${escHtml(inv.serie)} ${escHtml(inv.folio)}</span></div>
  </div>
</div>

<p class="ley-apocrifa">La reproducción apócrifa de este comprobante constituye un delito en los términos de las disposiciones fiscales.</p>

<div class="cliente-box">
  <div class="row"><span class="k">NOMBRE:</span><span class="v">${escHtml(nombreRec)}</span></div>
  <div class="row"><span class="k">RFC CLIENTE:</span><span class="v">${escHtml(rfcRec)}</span></div>
  <div class="meta-rec">
    C.P.: ${escHtml(cpRec || '—')} · Régimen fiscal: ${regimenLabel(regRec)} · Uso CFDI: ${usoCfdiLabel(uso)} ·
    Lugar de expedición: ${escHtml(inv.lugarExpedicion || emisor.lugarExpedicion || '—')} ·
    Fecha y hora de emisión: ${escHtml(formatInAppTimezone(inv.fechaEmision, { dateStyle: 'full', timeStyle: 'short' }))}
  </div>
</div>

<table class="clasica">
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
    <p class="aduanero">NÚMERO Y FECHA DE DOCUMENTO ADUANERO: _____________________________<br/>
    <span>(solo aplica en la importación de mercancías respecto de las que realicen ventas de primera mano)</span></p>
    ${qrBlock}
    <div class="sicofi">NÚMERO DE APROBACIÓN SICOFI: _____________________________</div>
    <div class="pago-caja">${escHtml(metodoPagoTexto)}</div>
    <p class="cfdi-nota">Forma de pago: ${formaPagoLabel(inv.formaPago)}. Representación impresa de CFDI 4.0; la validez fiscal la determina el XML timbrado y la verificación en el portal del SAT.</p>
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
${uuidBloque}
${noCert}
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
