import type { Invoice } from '@/types';
import { assertReceiverFiscal } from '@/lib/facturama/validateCfdi';

function money2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

/**
 * Complemento de pago 2.0 (CfdiType P) ligado a factura(s) PPD.
 */
export function mapPaymentComplementToFacturama(opts: {
  invoice: Invoice;
  paymentDate: Date | string;
  paymentForm: string;
  amountPaid: number;
  previousBalance: number;
  partialityNumber: number;
  serie?: string;
  folio?: string;
}): Record<string, unknown> {
  const { invoice } = opts;
  if (!invoice.uuid?.trim()) {
    throw new Error('La factura debe estar timbrada (UUID) para emitir complemento de pago');
  }
  if (invoice.metodoPago !== 'PPD' && invoice.formaPago !== '99') {
    throw new Error('El complemento de pago solo aplica a facturas PPD u Otros (forma 99)');
  }

  const cliente = invoice.cliente;
  const { rfc, name, regimen, taxZip, expeditionPlace } = assertReceiverFiscal({
    rfc: cliente?.rfc,
    name: cliente?.razonSocial || cliente?.nombre,
    regimen: cliente?.regimenFiscal,
    taxZip: cliente?.codigoPostal ?? cliente?.direccion?.codigoPostal,
    expeditionPlace: invoice.lugarExpedicion,
  });

  const amount = Math.round((Number(opts.amountPaid) || 0) * 100) / 100;
  const prev = Math.round((Number(opts.previousBalance) || 0) * 100) / 100;
  if (amount <= 0) throw new Error('El monto del pago debe ser mayor a cero');
  if (amount > prev + 0.001) {
    throw new Error('El monto pagado no puede superar el saldo insoluto anterior');
  }

  const date =
    opts.paymentDate instanceof Date
      ? opts.paymentDate
      : new Date(opts.paymentDate);
  if (Number.isNaN(date.getTime())) throw new Error('Fecha de pago inválida');

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const paymentDateStr = `${yyyy}-${mm}-${dd}`;

  return {
    NameId: 14,
    CfdiType: 'P',
    ExpeditionPlace: expeditionPlace,
    Serie: opts.serie || undefined,
    Folio: opts.folio ? String(opts.folio) : undefined,
    Exportation: '01',
    Receiver: {
      Rfc: rfc,
      Name: name,
      CfdiUse: 'CP01',
      FiscalRegime: regimen,
      TaxZipCode: taxZip,
      ...(String(cliente?.email ?? '').trim().includes('@')
        ? { Email: String(cliente?.email).trim() }
        : {}),
    },
    Complemento: {
      Payments: [
        {
          Date: paymentDateStr,
          PaymentForm: String(opts.paymentForm || '03'),
          Currency: 'MXN',
          Amount: money2(amount),
          RelatedDocuments: [
            {
              Uuid: invoice.uuid.trim().toUpperCase(),
              Serie: invoice.serie || undefined,
              Folio: String(invoice.folio || ''),
              Currency: 'MXN',
              PaymentMethod: 'PPD',
              PartialityNumber: String(opts.partialityNumber),
              PreviousBalanceAmount: money2(prev),
              AmountPaid: money2(amount),
              TaxObject: '01',
            },
          ],
        },
      ],
    },
  };
}
