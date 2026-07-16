import {
  extractSelloFromCfdiXml,
  extractUuidFromCfdiXml,
  facturamaCancel,
  facturamaCreate,
  facturamaDownload,
  facturamaStatus,
  pickFacturamaIds,
} from '@/lib/facturama/client';
import { mapInvoiceToFacturama } from '@/lib/facturama/mapInvoiceToFacturama';
import { mapCreditNoteToFacturama } from '@/lib/facturama/mapCreditNoteToFacturama';
import { mapPaymentComplementToFacturama } from '@/lib/facturama/mapPaymentComplementToFacturama';
import { mapNominaToFacturama, type NominaPayloadInput } from '@/lib/facturama/mapNominaToFacturama';
import type { Invoice, InvoicePaymentComplement, InvoiceRelatedCfdi } from '@/types';
import { getFiscalConfig } from '@/db/database';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';
import { updateInvoiceFirestore } from '@/lib/firestore/invoicesFirestore';

async function downloadStampedArtifacts(facturamaId: string, type: 'issued' | 'payroll' = 'issued') {
  const dl = await facturamaDownload({ id: facturamaId, type, format: 'xml' });
  const xml = dl.text ?? '';
  const uuid = extractUuidFromCfdiXml(xml);
  const selloDigital = extractSelloFromCfdiXml(xml);
  return { xml, uuid, selloDigital };
}

async function persistInvoiceUpdate(invoiceId: string, updates: Partial<Invoice>) {
  const sid = getEffectiveSucursalId();
  if (!sid) throw new Error('Se requiere sucursal para guardar el CFDI timbrado');
  await updateInvoiceFirestore(sid, invoiceId, updates);
}

/**
 * Timbrar factura de ingreso (I) vía Facturama. Rechaza modo prueba.
 */
export async function stampInvoiceWithFacturama(invoice: Invoice): Promise<Invoice> {
  const cfg = await getFiscalConfig();
  if (cfg?.modoPruebaFiscal || invoice.esPrueba) {
    throw new Error(
      'Modo prueba fiscal activo: no se timbra ante el SAT. Desactívelo en Configuración → Datos fiscales.'
    );
  }
  if (invoice.estado === 'timbrada' && invoice.uuid) {
    throw new Error('La factura ya está timbrada');
  }
  if (invoice.estado === 'cancelada') {
    throw new Error('No se puede timbrar una factura cancelada');
  }

  const payload = mapInvoiceToFacturama(invoice);
  const { cfdi } = await facturamaCreate(payload);
  const { facturamaId, uuid: uuidFromCreate } = pickFacturamaIds(cfdi as Record<string, unknown>);
  const artifacts = await downloadStampedArtifacts(facturamaId, 'issued');
  const uuid = (artifacts.uuid || uuidFromCreate || '').toUpperCase();
  if (!uuid) throw new Error('No se obtuvo UUID del timbre');

  const updates: Partial<Invoice> = {
    facturamaId,
    uuid,
    xml: artifacts.xml || undefined,
    selloDigital: artifacts.selloDigital,
    fechaTimbrado: new Date(),
    estado: 'timbrada',
  };
  await persistInvoiceUpdate(invoice.id, updates);
  return { ...invoice, ...updates };
}

export async function cancelStampedInvoiceWithFacturama(opts: {
  invoice: Invoice;
  motive: string;
  uuidReplacement?: string;
}): Promise<Invoice> {
  const { invoice, motive } = opts;
  if (!invoice.facturamaId) {
    throw new Error('La factura no tiene Id de Facturama; cancele solo registros locales no timbrados');
  }
  if (invoice.estado !== 'timbrada' && invoice.estado !== 'enviada') {
    // permitir cancelar timbrada; enviada sin timbre no debería tener facturamaId
  }
  if (!invoice.uuid) {
    throw new Error('Solo se cancelan ante el SAT facturas con UUID');
  }

  const { cancel } = await facturamaCancel({
    id: invoice.facturamaId,
    type: 'issued',
    motive,
    uuidReplacement: opts.uuidReplacement,
  });

  const acuse =
    typeof (cancel as { AcuseXmlBase64?: string }).AcuseXmlBase64 === 'string'
      ? (cancel as { AcuseXmlBase64: string }).AcuseXmlBase64
      : JSON.stringify(cancel);

  const status = String((cancel as { Status?: string }).Status ?? '').toLowerCase();
  const updates: Partial<Invoice> = {
    motivoCancelacion: motive,
    fechaCancelacion: new Date(),
    acuseCancelacion: acuse,
    estado: status === 'pending' ? 'timbrada' : 'cancelada',
  };
  // Si queda pending de aceptación, marcamos cancelada solo cuando Status=canceled;
  // para pending dejamos timbrada pero guardamos acuse/motivo.
  if (status === 'canceled' || status === 'cancelled' || !status) {
    updates.estado = 'cancelada';
  }

  await persistInvoiceUpdate(invoice.id, updates);
  return { ...invoice, ...updates };
}

export async function downloadInvoiceXmlFromFacturama(invoice: Invoice): Promise<string> {
  if (!invoice.facturamaId) {
    if (invoice.xml) return invoice.xml;
    throw new Error('Sin Id Facturama ni XML local');
  }
  const dl = await facturamaDownload({ id: invoice.facturamaId, type: 'issued', format: 'xml' });
  if (!dl.text) throw new Error('XML vacío');
  if (dl.text !== invoice.xml) {
    await persistInvoiceUpdate(invoice.id, { xml: dl.text, selloDigital: extractSelloFromCfdiXml(dl.text) });
  }
  return dl.text;
}

export async function downloadInvoicePdfBase64FromFacturama(invoice: Invoice): Promise<string> {
  if (!invoice.facturamaId) throw new Error('Sin Id Facturama');
  const dl = await facturamaDownload({ id: invoice.facturamaId, type: 'issued', format: 'pdf' });
  if (!dl.base64) throw new Error('PDF vacío');
  return dl.base64;
}

export async function stampCreditNoteWithFacturama(opts: {
  original: Invoice;
  serie?: string;
  folio?: string;
}): Promise<{ invoice: Invoice; related: InvoiceRelatedCfdi }> {
  const cfg = await getFiscalConfig();
  if (cfg?.modoPruebaFiscal) {
    throw new Error('Modo prueba fiscal: no se emiten notas de crédito ante el SAT');
  }
  const payload = mapCreditNoteToFacturama({
    original: opts.original,
    serie: opts.serie,
    folio: opts.folio,
  });
  const { cfdi } = await facturamaCreate(payload);
  const { facturamaId, uuid: uuidFromCreate } = pickFacturamaIds(cfdi as Record<string, unknown>);
  const artifacts = await downloadStampedArtifacts(facturamaId, 'issued');
  const uuid = (artifacts.uuid || uuidFromCreate || '').toUpperCase();
  if (!uuid) throw new Error('No se obtuvo UUID de la nota de crédito');

  const related: InvoiceRelatedCfdi = {
    id: crypto.randomUUID(),
    facturamaId,
    uuid,
    tipo: 'E',
    serie: opts.serie || opts.original.serie,
    folio: opts.folio,
    total: opts.original.total,
    fechaTimbrado: new Date().toISOString(),
    xml: artifacts.xml,
    selloDigital: artifacts.selloDigital,
    estado: 'timbrada',
  };

  const list = [...(opts.original.cfdisRelacionados ?? []), related];
  await persistInvoiceUpdate(opts.original.id, { cfdisRelacionados: list });
  return { invoice: { ...opts.original, cfdisRelacionados: list }, related };
}

export async function stampPaymentComplementWithFacturama(opts: {
  invoice: Invoice;
  paymentDate: Date;
  paymentForm: string;
  amountPaid: number;
  previousBalance: number;
  partialityNumber: number;
  serie?: string;
  folio?: string;
}): Promise<{ invoice: Invoice; complement: InvoicePaymentComplement }> {
  const cfg = await getFiscalConfig();
  if (cfg?.modoPruebaFiscal) {
    throw new Error('Modo prueba fiscal: no se emiten complementos de pago ante el SAT');
  }

  const payload = mapPaymentComplementToFacturama({
    invoice: opts.invoice,
    paymentDate: opts.paymentDate,
    paymentForm: opts.paymentForm,
    amountPaid: opts.amountPaid,
    previousBalance: opts.previousBalance,
    partialityNumber: opts.partialityNumber,
    serie: opts.serie,
    folio: opts.folio,
  });
  const { cfdi } = await facturamaCreate(payload);
  const { facturamaId, uuid: uuidFromCreate } = pickFacturamaIds(cfdi as Record<string, unknown>);
  const artifacts = await downloadStampedArtifacts(facturamaId, 'issued');
  const uuid = (artifacts.uuid || uuidFromCreate || '').toUpperCase();
  if (!uuid) throw new Error('No se obtuvo UUID del complemento de pago');

  const complement: InvoicePaymentComplement = {
    id: crypto.randomUUID(),
    facturamaId,
    uuid,
    fechaPago:
      opts.paymentDate instanceof Date
        ? opts.paymentDate.toISOString().slice(0, 10)
        : String(opts.paymentDate).slice(0, 10),
    formaPago: opts.paymentForm,
    monto: opts.amountPaid,
    saldoAnterior: opts.previousBalance,
    numeroParcialidad: opts.partialityNumber,
    fechaTimbrado: new Date().toISOString(),
    xml: artifacts.xml,
    selloDigital: artifacts.selloDigital,
    estado: 'timbrada',
  };

  const list = [...(opts.invoice.complementosPago ?? []), complement];
  await persistInvoiceUpdate(opts.invoice.id, { complementosPago: list });
  return { invoice: { ...opts.invoice, complementosPago: list }, complement };
}

export async function stampNominaWithFacturama(input: NominaPayloadInput): Promise<{
  facturamaId: string;
  uuid: string;
  xml?: string;
  selloDigital?: string;
  fechaTimbrado: Date;
}> {
  const cfg = await getFiscalConfig();
  if (cfg?.modoPruebaFiscal) {
    throw new Error('Modo prueba fiscal: no se timbra nómina ante el SAT');
  }
  const payload = mapNominaToFacturama(input);
  const { cfdi } = await facturamaCreate(payload);
  const { facturamaId, uuid: uuidFromCreate } = pickFacturamaIds(cfdi as Record<string, unknown>);
  const artifacts = await downloadStampedArtifacts(facturamaId, 'payroll');
  const uuid = (artifacts.uuid || uuidFromCreate || '').toUpperCase();
  if (!uuid) throw new Error('No se obtuvo UUID de la nómina');
  return {
    facturamaId,
    uuid,
    xml: artifacts.xml,
    selloDigital: artifacts.selloDigital,
    fechaTimbrado: new Date(),
  };
}

export async function cancelNominaWithFacturama(opts: {
  facturamaId: string;
  motive: string;
  uuidReplacement?: string;
}) {
  return facturamaCancel({
    id: opts.facturamaId,
    type: 'payroll',
    motive: opts.motive,
    uuidReplacement: opts.uuidReplacement,
  });
}

export async function testFacturamaConnection() {
  return facturamaStatus();
}
