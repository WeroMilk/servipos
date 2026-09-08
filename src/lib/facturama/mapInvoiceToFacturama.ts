import type { Invoice, InvoiceItem } from '@/types';
import { describeClaveUnidadSat, resolveClaveProdServ } from '@/lib/satCatalog';
import { mapInvoiceTaxesToFacturama, money2facturama } from '@/lib/facturama/taxes';
import { assertPagoCfdi, assertReceiverFiscal } from '@/lib/facturama/validateCfdi';

function qtyStr(n: number, unitCode: string): string {
  if (unitCode === 'MTR' || unitCode === 'CMT') {
    return String(Math.round((Number(n) || 0) * 1000) / 1000);
  }
  return money2facturama(n);
}

/**
 * Mapea una factura POS a payload Facturama API Web CFDI 4.0 tipo Ingreso.
 * El emisor se toma del perfil fiscal de la cuenta Facturama (no se envía Issuer).
 */
export function mapInvoiceToFacturama(invoice: Invoice): Record<string, unknown> {
  const cliente = invoice.cliente;
  const { rfc, name, regimen, taxZip, expeditionPlace } = assertReceiverFiscal({
    rfc: cliente?.rfc,
    name: cliente?.razonSocial || cliente?.nombre,
    regimen: cliente?.regimenFiscal,
    taxZip: cliente?.codigoPostal ?? cliente?.direccion?.codigoPostal,
    expeditionPlace: invoice.lugarExpedicion,
  });
  const uso = String(cliente?.usoCfdi || 'G03').trim();
  assertPagoCfdi(String(invoice.metodoPago || 'PUE'), String(invoice.formaPago || '01'));

  const items = (invoice.productos ?? []).map((p: InvoiceItem) => {
    const unitCode = String(p.claveUnidad || 'H87');
    const taxes = mapInvoiceTaxesToFacturama(p);
    const hasTaxes = taxes.length > 0;
    return {
      Quantity: qtyStr(p.cantidad, unitCode),
      ProductCode: resolveClaveProdServ(p.claveProdServ),
      UnitCode: unitCode,
      Unit: describeClaveUnidadSat(unitCode),
      Description: String(p.descripcion || 'Concepto').slice(0, 1000),
      IdentificationNumber: p.productId ? String(p.productId).slice(0, 100) : undefined,
      UnitPrice: money2facturama(p.precioUnitario),
      Subtotal: money2facturama(p.subtotal),
      Discount: p.descuento > 0 ? money2facturama(p.descuento) : undefined,
      TaxObject: hasTaxes ? '02' : '01',
      Taxes: hasTaxes ? taxes : undefined,
      Total: money2facturama(p.total),
    };
  });

  if (!items.length) throw new Error('La factura no tiene conceptos');

  const email = String(cliente?.email ?? '').trim();

  return {
    NameId: 1,
    CfdiType: 'I',
    ExpeditionPlace: expeditionPlace,
    Serie: invoice.serie || undefined,
    Folio: String(invoice.folio || ''),
    PaymentForm: String(invoice.formaPago || '01'),
    PaymentMethod: String(invoice.metodoPago || 'PUE'),
    Currency: 'MXN',
    Exportation: '01',
    Receiver: {
      Rfc: rfc,
      Name: name,
      CfdiUse: uso,
      FiscalRegime: regimen,
      TaxZipCode: taxZip,
      ...(email && email.includes('@') ? { Email: email } : {}),
    },
    Items: items,
  };
}
