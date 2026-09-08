import type { Client, FiscalConfig, FormaPago, Invoice, MetodoPago, Sale } from '@/types';
import { getInvoiceById } from '@/db/database';
import { getInvoiceFirestore } from '@/lib/firestore/invoicesFirestore';
import { buildInvoiceFromSale } from '@/lib/facturama/buildInvoiceFromSale';
import { stampInvoiceWithFacturama, sendInvoiceEmailWithFacturama } from '@/hooks/useFacturama';
import { mergeClienteDatosFiscales, resolveLiveClient } from '@/lib/facturama/hydrateInvoiceCliente';

export async function invoiceAndStampCompletedSale(opts: {
  sale: Sale;
  client: Client;
  fiscalConfig: FiscalConfig;
  usoCfdi: string;
  formaPago: FormaPago;
  metodoPago: MetodoPago;
  sucursalId: string | null | undefined;
  addInvoice: (
    invoice: Omit<Invoice, 'id' | 'folio' | 'serie' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'esPrueba'>
  ) => Promise<string>;
}): Promise<{
  invoiceId: string;
  stamped: boolean;
  esPrueba: boolean;
  uuid?: string;
  folio?: string;
  serie?: string;
}> {
  const live = await resolveLiveClient(opts.client.id || opts.sale.clienteId);
  const client = mergeClienteDatosFiscales(opts.client, live) ?? opts.client;
  const draft = buildInvoiceFromSale({
    sale: opts.sale,
    client,
    fiscalConfig: opts.fiscalConfig,
    formaPago: opts.formaPago,
    metodoPago: opts.metodoPago,
    usoCfdi: opts.usoCfdi,
  });
  const invoiceId = await opts.addInvoice(draft);
  if (opts.fiscalConfig.modoPruebaFiscal) {
    return { invoiceId, stamped: false, esPrueba: true };
  }

  const sid = opts.sucursalId?.trim();
  const created = sid
    ? await getInvoiceFirestore(sid, invoiceId)
    : ((await getInvoiceById(invoiceId)) ?? null);
  if (!created) {
    throw new Error('Se creó la factura local pero no se pudo recargar para timbrar');
  }

  const stamped = await stampInvoiceWithFacturama(created);
  const email = String(client.email ?? opts.client.email ?? '').trim();
  if (email.includes('@') && stamped.facturamaId) {
    try {
      await sendInvoiceEmailWithFacturama({
        invoice: stamped,
        email,
        subject: `Factura ${stamped.serie}-${stamped.folio}`,
      });
    } catch {
      /* el CFDI ya está timbrado; el correo se puede reenviar en Facturación */
    }
  }
  return {
    invoiceId,
    stamped: true,
    esPrueba: false,
    uuid: stamped.uuid,
    folio: stamped.folio,
    serie: stamped.serie,
  };
}
