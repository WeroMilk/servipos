import type { Invoice, InvoiceItem } from '@/types';

function money2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function itemTaxes(item: InvoiceItem): Array<Record<string, string>> {
  const taxes: Array<Record<string, string>> = [];
  for (const t of item.impuestosTrasladados ?? []) {
    const name = t.impuesto === '003' ? 'IEPS' : 'IVA';
    taxes.push({
      Name: name,
      Rate: String(t.tasaOCuota ?? 0),
      Total: money2(t.importe),
      Base: money2(t.base),
      IsRetention: 'false',
      IsFederalTax: 'true',
      ...(t.tipoFactor === 'Cuota' ? { IsQuota: 'true' } : {}),
    });
  }
  for (const t of item.impuestosRetenidos ?? []) {
    const name = t.impuesto === '003' ? 'IEPS' : 'IVA';
    taxes.push({
      Name: name === 'IVA' ? 'IVA RET' : name,
      Rate: String(t.tasaOCuota ?? 0),
      Total: money2(t.importe),
      Base: money2(t.base),
      IsRetention: 'true',
      IsFederalTax: 'true',
    });
  }
  return taxes;
}

/**
 * Mapea una factura POS a payload Facturama API Web CFDI 4.0 tipo Ingreso.
 * El emisor se toma del perfil fiscal de la cuenta Facturama (no se envía Issuer).
 */
export function mapInvoiceToFacturama(invoice: Invoice): Record<string, unknown> {
  const cliente = invoice.cliente;
  if (!cliente?.rfc?.trim()) {
    throw new Error('El receptor debe tener RFC');
  }
  const name = (cliente.razonSocial || cliente.nombre || '').trim().toUpperCase();
  if (!name) throw new Error('El receptor debe tener nombre o razón social');

  const regimen = String(cliente.regimenFiscal ?? '').trim();
  const uso = String(cliente.usoCfdi || 'G03').trim();
  const taxZip =
    String(cliente.codigoPostal ?? cliente.direccion?.codigoPostal ?? '').trim() ||
    String(invoice.lugarExpedicion ?? '').trim();
  if (!regimen) throw new Error('El receptor debe tener régimen fiscal');
  if (!taxZip) throw new Error('El receptor debe tener código postal (TaxZipCode)');
  if (!String(invoice.lugarExpedicion || '').trim()) {
    throw new Error('Falta lugar de expedición (código postal de la sucursal en Facturama)');
  }

  const items = (invoice.productos ?? []).map((p) => {
    const taxes = itemTaxes(p);
    const hasTaxes = taxes.length > 0;
    return {
      Quantity: money2(p.cantidad),
      ProductCode: String(p.claveProdServ || '01010101'),
      UnitCode: String(p.claveUnidad || 'H87'),
      Unit: 'Pieza',
      Description: String(p.descripcion || 'Concepto').slice(0, 1000),
      IdentificationNumber: p.productId ? String(p.productId).slice(0, 100) : undefined,
      UnitPrice: money2(p.precioUnitario),
      Subtotal: money2(p.subtotal),
      Discount: p.descuento > 0 ? money2(p.descuento) : undefined,
      TaxObject: hasTaxes ? '02' : '01',
      Taxes: hasTaxes ? taxes : undefined,
      Total: money2(p.total),
    };
  });

  if (!items.length) throw new Error('La factura no tiene conceptos');

  return {
    NameId: '1',
    CfdiType: 'I',
    ExpeditionPlace: String(invoice.lugarExpedicion).trim(),
    Serie: invoice.serie || undefined,
    Folio: String(invoice.folio || ''),
    PaymentForm: String(invoice.formaPago || '01'),
    PaymentMethod: String(invoice.metodoPago || 'PUE'),
    Currency: 'MXN',
    Exportation: '01',
    Receiver: {
      Rfc: cliente.rfc.trim().toUpperCase(),
      Name: name,
      CfdiUse: uso,
      FiscalRegime: regimen,
      TaxZipCode: taxZip,
    },
    Items: items,
  };
}
