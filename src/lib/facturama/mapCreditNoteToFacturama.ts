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
    });
  }
  return taxes;
}

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
  if (!cliente?.rfc?.trim()) throw new Error('Receptor sin RFC');

  const productos = opts.productos?.length ? opts.productos : original.productos;
  const items = productos.map((p) => {
    const taxes = itemTaxes(p);
    const hasTaxes = taxes.length > 0;
    return {
      Quantity: money2(p.cantidad),
      ProductCode: String(p.claveProdServ || '84111506'),
      UnitCode: String(p.claveUnidad || 'ACT'),
      Unit: 'Actividad',
      Description: String(p.descripcion || 'Nota de crédito').slice(0, 1000),
      UnitPrice: money2(p.precioUnitario),
      Subtotal: money2(p.subtotal),
      Discount: p.descuento > 0 ? money2(p.descuento) : undefined,
      TaxObject: hasTaxes ? '02' : '01',
      Taxes: hasTaxes ? taxes : undefined,
      Total: money2(p.total),
    };
  });

  if (!items.length) throw new Error('La nota de crédito no tiene conceptos');

  const name = (cliente.razonSocial || cliente.nombre || '').trim().toUpperCase();
  const taxZip =
    String(cliente.codigoPostal ?? cliente.direccion?.codigoPostal ?? '').trim() ||
    String(original.lugarExpedicion ?? '').trim();

  return {
    NameId: '2',
    CfdiType: 'E',
    ExpeditionPlace: String(original.lugarExpedicion).trim(),
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
      Rfc: cliente.rfc.trim().toUpperCase(),
      Name: name,
      CfdiUse: String(cliente.usoCfdi || 'G02'),
      FiscalRegime: String(cliente.regimenFiscal || ''),
      TaxZipCode: taxZip,
    },
    Items: items,
  };
}
