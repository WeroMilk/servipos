import type { Invoice, InvoiceItem } from '@/types';
import { describeClaveUnidadSat } from '@/lib/satCatalog';
import { mapInvoiceTaxesToFacturama, money2facturama } from '@/lib/facturama/taxes';
import { assertReceiverFiscal } from '@/lib/facturama/validateCfdi';

/**
 * Nota de crédito (CfdiType E) relacionada a una factura timbrada.
 * @param tipoRelacion SAT: 01 = Nota de crédito de los documentos relacionados
 */
export function mapCreditNoteToFacturama(opts: {
  original: Invoice;
  /** Conceptos de la NC; por defecto copia los de la factura original. */
  productos?: InvoiceItem[];
  serie?: string;
  folio?: string;
  formaPago?: string;
  tipoRelacion?: string;
}): Record<string, unknown> {
  const { original } = opts;
  if (!original.uuid?.trim()) {
    throw new Error('La factura original debe estar timbrada (UUID)');
  }
  const cliente = original.cliente;
  const { rfc, name, regimen, taxZip, expeditionPlace } = assertReceiverFiscal({
    rfc: cliente?.rfc,
    name: cliente?.razonSocial || cliente?.nombre,
    regimen: cliente?.regimenFiscal,
    taxZip: cliente?.codigoPostal ?? cliente?.direccion?.codigoPostal,
    expeditionPlace: original.lugarExpedicion,
  });

  const productos = opts.productos?.length ? opts.productos : original.productos;
  const items = productos.map((p) => {
    const unitCode = String(p.claveUnidad || 'ACT');
    const taxes = mapInvoiceTaxesToFacturama(p);
    const hasTaxes = taxes.length > 0;
    return {
      Quantity: money2facturama(p.cantidad),
      ProductCode: String(p.claveProdServ || '84111506'),
      UnitCode: unitCode,
      Unit: unitCode === 'ACT' ? 'Actividad' : describeClaveUnidadSat(unitCode),
      Description: String(p.descripcion || 'Nota de crédito').slice(0, 1000),
      UnitPrice: money2facturama(p.precioUnitario),
      Subtotal: money2facturama(p.subtotal),
      Discount: p.descuento > 0 ? money2facturama(p.descuento) : undefined,
      TaxObject: hasTaxes ? '02' : '01',
      Taxes: hasTaxes ? taxes : undefined,
      Total: money2facturama(p.total),
    };
  });

  if (!items.length) throw new Error('La nota de crédito no tiene conceptos');

  const email = String(cliente?.email ?? '').trim();

  return {
    NameId: 2,
    CfdiType: 'E',
    ExpeditionPlace: expeditionPlace,
    Serie: opts.serie || original.serie || undefined,
    Folio: opts.folio ? String(opts.folio) : undefined,
    PaymentForm: opts.formaPago || '99',
    PaymentMethod: 'PUE',
    Currency: 'MXN',
    Exportation: '01',
    Relations: {
      Type: opts.tipoRelacion || '01',
      Cfdis: [{ Uuid: original.uuid.trim().toUpperCase() }],
    },
    Receiver: {
      Rfc: rfc,
      Name: name,
      CfdiUse: String(cliente?.usoCfdi || 'G02'),
      FiscalRegime: regimen,
      TaxZipCode: taxZip,
      ...(email && email.includes('@') ? { Email: email } : {}),
    },
    Items: items,
  };
}
