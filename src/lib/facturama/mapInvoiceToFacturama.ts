import type { Invoice, InvoiceItem } from '@/types';
import { describeClaveUnidadSat, resolveClaveProdServ } from '@/lib/satCatalog';
import { mapInvoiceTaxesToFacturama, money2facturama, conceptoImportesCfdi, roundMoney2 } from '@/lib/facturama/taxes';
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
    const imp = conceptoImportesCfdi(p);
    const tasa0 = p.impuestosTrasladados?.[0]?.tasaOCuota;
    const tasa = Number(tasa0) > 0 ? Number(tasa0) : 0;
    const iva = tasa > 0 ? roundMoney2(imp.base * tasa) : 0;
    const itemForTaxes: InvoiceItem = {
      ...p,
      subtotal: imp.subtotal,
      descuento: imp.descuento,
      total: roundMoney2(imp.base + iva),
      impuestosTrasladados:
        tasa > 0
          ? [
              {
                tipo: 'Traslado',
                impuesto: '002',
                tipoFactor: 'Tasa',
                tasaOCuota: tasa,
                base: imp.base,
                importe: iva,
              },
            ]
          : [],
    };
    const taxes = mapInvoiceTaxesToFacturama(itemForTaxes);
    const hasTaxes = taxes.length > 0;
    const idNum = p.productId ? String(p.productId).trim() : '';
    const identification =
      idNum &&
      idNum.length <= 40 &&
      !idNum.includes(' ') &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idNum)
        ? idNum
        : undefined;
    return {
      Quantity: qtyStr(p.cantidad, unitCode),
      ProductCode: resolveClaveProdServ(p.claveProdServ),
      UnitCode: unitCode,
      Unit: describeClaveUnidadSat(unitCode),
      Description: String(p.descripcion || 'Concepto').slice(0, 1000),
      IdentificationNumber: identification,
      UnitPrice: money2facturama(p.precioUnitario),
      Subtotal: money2facturama(imp.subtotal),
      Discount: imp.descuento > 0 ? money2facturama(imp.descuento) : undefined,
      TaxObject: hasTaxes ? '02' : '01',
      Taxes: hasTaxes ? taxes : undefined,
      Total: money2facturama(imp.base + iva),
    };
  });

  if (!items.length) throw new Error('La factura no tiene conceptos');

  const email = String(cliente?.email ?? '').trim();

  const payload: Record<string, unknown> = {
    NameId: 1,
    CfdiType: 'I',
    ExpeditionPlace: expeditionPlace,
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
  const observaciones = String(invoice.observaciones ?? '')
    .trim()
    .slice(0, 1000);
  if (observaciones) payload.Observations = observaciones;
  /** Folio/serie los asigna Facturama (sucursal del CP). Enviar los locales suele impedir el timbre. */
  return payload;
}
