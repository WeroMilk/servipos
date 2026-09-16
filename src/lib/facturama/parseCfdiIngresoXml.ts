import type { Client, FiscalConfig, FormaPago, Invoice, InvoiceItem, MetodoPago } from '@/types';

export function xmlAttr(fragment: string, name: string): string {
  const re = new RegExp(`(?:^|[\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = fragment.match(re);
  return decodeXmlEntities((m?.[1] ?? m?.[2] ?? '').trim());
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function firstTagAttrs(xml: string, localName: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b([^>]*)>`, 'i');
  const m = xml.match(re);
  return m?.[1] ?? null;
}

function allTagAttrs(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b([^>]*)>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(m[1] ?? '');
  }
  return out;
}

function moneyAttr(fragment: string, name: string): number {
  const raw = xmlAttr(fragment, name).replace(/,/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export type ParsedCfdiIngreso = {
  uuid: string;
  serie: string;
  folio: string;
  tipoDeComprobante: string;
  metodoPago: string;
  formaPago: string;
  subtotal: number;
  descuento: number;
  total: number;
  fechaEmision: Date;
  fechaTimbrado?: Date;
  lugarExpedicion: string;
  selloDigital?: string;
  emisorRfc: string;
  receptorRfc: string;
  receptorNombre: string;
  receptorRegimen: string;
  receptorCp: string;
  receptorUsoCfdi: string;
  conceptos: Array<{
    claveProdServ: string;
    claveUnidad: string;
    cantidad: number;
    descripcion: string;
    precioUnitario: number;
    descuento: number;
    subtotal: number;
    total: number;
  }>;
};

export function parseCfdiIngresoXml(xmlRaw: string): ParsedCfdiIngreso {
  const xml = String(xmlRaw ?? '').replace(/^\uFEFF/, '').trim();
  if (!xml || !xml.includes('<')) {
    throw new Error('Pegue o suba el XML del CFDI de ingreso.');
  }

  const comp = firstTagAttrs(xml, 'Comprobante');
  if (!comp) throw new Error('No se encontró el nodo Comprobante en el XML.');

  const tipo = xmlAttr(comp, 'TipoDeComprobante').toUpperCase();
  if (tipo && tipo !== 'I') {
    throw new Error(
      tipo === 'P'
        ? 'Ese XML es un complemento de pago, no una factura de ingreso.'
        : `Solo se importan CFDI de ingreso (tipo I). Este es tipo ${tipo}.`
    );
  }

  const uuidM =
    xml.match(/\bUUID="([^"]+)"/i) || xml.match(/\bUUID\s*=\s*'([^']+)'/i);
  const uuid = (uuidM?.[1] ?? '').trim().toUpperCase();
  if (!uuid || uuid.length < 30) {
    throw new Error('El XML no tiene UUID de timbre SAT. No se puede complementar.');
  }

  const metodoPago = xmlAttr(comp, 'MetodoPago').toUpperCase() || 'PPD';
  const formaPago = xmlAttr(comp, 'FormaPago') || '99';
  if (metodoPago !== 'PPD' && formaPago !== '99') {
    throw new Error(
      'Solo se importan facturas PPD u Otros (forma 99). Un PUE ya cobrado no lleva complemento de pago.'
    );
  }

  const emisor = firstTagAttrs(xml, 'Emisor') ?? '';
  const receptor = firstTagAttrs(xml, 'Receptor') ?? '';
  const receptorRfc = xmlAttr(receptor, 'Rfc').toUpperCase();
  if (!receptorRfc) throw new Error('El XML no trae RFC del receptor.');

  const fechaRaw = xmlAttr(comp, 'Fecha');
  const fechaEmision = fechaRaw ? new Date(fechaRaw) : new Date();
  const timbre = firstTagAttrs(xml, 'TimbreFiscalDigital') ?? '';
  const fechaTimbradoRaw = xmlAttr(timbre, 'FechaTimbrado');
  const fechaTimbrado = fechaTimbradoRaw ? new Date(fechaTimbradoRaw) : undefined;

  const subtotal = moneyAttr(comp, 'SubTotal');
  const descuento = moneyAttr(comp, 'Descuento');
  const total = moneyAttr(comp, 'Total');
  if (!(total > 0)) throw new Error('El XML no trae un Total válido.');

  const conceptos = allTagAttrs(xml, 'Concepto').map((c) => {
    const cantidad = moneyAttr(c, 'Cantidad') || 1;
    const precioUnitario = moneyAttr(c, 'ValorUnitario');
    const desc = moneyAttr(c, 'Descuento');
    const importe = moneyAttr(c, 'Importe') || Math.round((cantidad * precioUnitario - desc) * 100) / 100;
    return {
      claveProdServ: xmlAttr(c, 'ClaveProdServ') || '01010101',
      claveUnidad: xmlAttr(c, 'ClaveUnidad') || 'H87',
      cantidad,
      descripcion: xmlAttr(c, 'Descripcion') || 'Concepto',
      precioUnitario,
      descuento: desc,
      subtotal: importe,
      total: importe,
    };
  });

  const sello =
    xmlAttr(comp, 'Sello') ||
    xmlAttr(timbre, 'SelloCFD') ||
    undefined;

  return {
    uuid,
    serie: xmlAttr(comp, 'Serie') || 'A',
    folio: xmlAttr(comp, 'Folio') || '',
    tipoDeComprobante: tipo || 'I',
    metodoPago: metodoPago === 'PUE' ? 'PUE' : 'PPD',
    formaPago,
    subtotal,
    descuento,
    total,
    fechaEmision: Number.isNaN(fechaEmision.getTime()) ? new Date() : fechaEmision,
    fechaTimbrado:
      fechaTimbrado && !Number.isNaN(fechaTimbrado.getTime()) ? fechaTimbrado : undefined,
    lugarExpedicion: xmlAttr(comp, 'LugarExpedicion'),
    selloDigital: sello,
    emisorRfc: xmlAttr(emisor, 'Rfc').toUpperCase(),
    receptorRfc,
    receptorNombre: xmlAttr(receptor, 'Nombre'),
    receptorRegimen: xmlAttr(receptor, 'RegimenFiscalReceptor'),
    receptorCp: xmlAttr(receptor, 'DomicilioFiscalReceptor'),
    receptorUsoCfdi: xmlAttr(receptor, 'UsoCFDI') || 'G03',
    conceptos,
  };
}

export function normalizeRfcKey(rfc: string): string {
  return String(rfc ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function buildExternalPpdInvoiceDraft(opts: {
  parsed: ParsedCfdiIngreso;
  xml: string;
  client: Client;
  fiscalConfig: FiscalConfig;
  montoPagadoPrevio: number;
  parcialidadSiguienteBase: number;
}): Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'> {
  const { parsed, client, fiscalConfig } = opts;
  const emisorKey = normalizeRfcKey(fiscalConfig.rfc);
  const xmlEmisor = normalizeRfcKey(parsed.emisorRfc);
  if (emisorKey && xmlEmisor && emisorKey !== xmlEmisor) {
    throw new Error(
      `El RFC emisor del XML (${parsed.emisorRfc}) no coincide con el de SERVIpos (${fiscalConfig.rfc}).`
    );
  }
  const productos: InvoiceItem[] = (parsed.conceptos.length
    ? parsed.conceptos
    : [
        {
          claveProdServ: '01010101',
          claveUnidad: 'H87',
          cantidad: 1,
          descripcion: 'Concepto CFDI externo',
          precioUnitario: parsed.subtotal,
          descuento: parsed.descuento,
          subtotal: parsed.subtotal,
          total: parsed.total,
        },
      ]
  ).map((c) => ({
    id: crypto.randomUUID(),
    productId: '',
    claveProdServ: c.claveProdServ,
    claveUnidad: c.claveUnidad,
    cantidad: c.cantidad,
    descripcion: c.descripcion,
    precioUnitario: c.precioUnitario,
    descuento: c.descuento,
    impuestosTrasladados: [],
    impuestosRetenidos: [],
    subtotal: c.subtotal,
    total: c.total,
  }));

  const iva = Math.max(0, Math.round((parsed.total - parsed.subtotal + parsed.descuento) * 100) / 100);
  const pagado = Math.max(0, Math.round((Number(opts.montoPagadoPrevio) || 0) * 100) / 100);
  if (pagado > parsed.total + 0.001) {
    throw new Error('Lo ya pagado no puede ser mayor que el total de la factura.');
  }

  return {
    uuid: parsed.uuid,
    folio: parsed.folio || parsed.uuid.slice(0, 8),
    serie: parsed.serie || 'EXT',
    clienteId: client.id,
    cliente: {
      ...client,
      rfc: parsed.receptorRfc || client.rfc,
      razonSocial: client.razonSocial || parsed.receptorNombre || client.nombre,
      nombre: client.nombre || parsed.receptorNombre,
      regimenFiscal: client.regimenFiscal || parsed.receptorRegimen,
      codigoPostal: client.codigoPostal || parsed.receptorCp,
      usoCfdi: parsed.receptorUsoCfdi || client.usoCfdi,
    },
    emisor: fiscalConfig,
    productos,
    subtotal: parsed.subtotal,
    descuento: parsed.descuento,
    impuestosTrasladados: iva,
    impuestosRetenidos: 0,
    total: parsed.total,
    formaPago: (parsed.formaPago || '99') as FormaPago,
    metodoPago: (parsed.metodoPago === 'PUE' ? 'PUE' : 'PPD') as MetodoPago,
    lugarExpedicion: parsed.lugarExpedicion || fiscalConfig.lugarExpedicion,
    fechaEmision: parsed.fechaEmision,
    fechaTimbrado: parsed.fechaTimbrado,
    selloDigital: parsed.selloDigital,
    estado: 'timbrada',
    xml: opts.xml,
    cfdiExterno: true,
    esPrueba: false,
    montoPagadoPrevio: pagado > 0 ? pagado : undefined,
    parcialidadSiguienteBase: Math.max(1, Math.floor(Number(opts.parcialidadSiguienteBase) || 1)),
  };
}
