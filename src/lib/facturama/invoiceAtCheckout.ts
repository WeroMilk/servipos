import type { Client, FiscalConfig, FormaPago, Invoice, MetodoPago, Sale } from '@/types';
import { getInvoiceById } from '@/db/database';
import { getInvoiceFirestore } from '@/lib/firestore/invoicesFirestore';
import { buildInvoiceFromSale } from '@/lib/facturama/buildInvoiceFromSale';
import { stampInvoiceWithFacturama, sendInvoiceEmailWithFacturama } from '@/hooks/useFacturama';
import { mergeClienteDatosFiscales, resolveLiveClient } from '@/lib/facturama/hydrateInvoiceCliente';

export function isCfdiEmailAddress(raw: string | undefined | null): boolean {
  const email = String(raw ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function invoiceAndStampCompletedSale(opts: {
  sale: Sale;
  client: Client;
  fiscalConfig: FiscalConfig;
  usoCfdi: string;
  formaPago: FormaPago;
  metodoPago: MetodoPago;
  sucursalId: string | null | undefined;
  /** Correo de este cobro (puede diferir del catálogo). */
  email?: string;
  /** Comentario opcional en el PDF oficial (Observations). */
  observaciones?: string;
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
  emailSent?: boolean;
  emailError?: string;
  emailSkipped?: boolean;
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
    observaciones: opts.observaciones,
  });
  const invoiceId = await opts.addInvoice(draft);
  if (opts.fiscalConfig.modoPruebaFiscal) {
    return { invoiceId, stamped: false, esPrueba: true, emailSkipped: true };
  }

  const sid = opts.sucursalId?.trim();
  const created = sid
    ? await getInvoiceFirestore(sid, invoiceId)
    : ((await getInvoiceById(invoiceId)) ?? null);
  if (!created) {
    throw new Error('Se creó la factura local pero no se pudo recargar para timbrar');
  }

  const stamped = await stampInvoiceWithFacturama(created);
  const email = String(opts.email ?? client.email ?? '').trim();
  if (!isCfdiEmailAddress(email)) {
    return {
      invoiceId,
      stamped: true,
      esPrueba: false,
      uuid: stamped.uuid,
      folio: stamped.folio,
      serie: stamped.serie,
      emailSkipped: true,
    };
  }
  if (!stamped.facturamaId) {
    return {
      invoiceId,
      stamped: true,
      esPrueba: false,
      uuid: stamped.uuid,
      folio: stamped.folio,
      serie: stamped.serie,
      emailError: 'Sin Id Facturama; el correo se puede reenviar en Facturación',
    };
  }
  try {
    await sendInvoiceEmailWithFacturama({
      invoice: stamped,
      email,
      subject: `Factura ${stamped.serie}-${stamped.folio}`,
    });
    return {
      invoiceId,
      stamped: true,
      esPrueba: false,
      uuid: stamped.uuid,
      folio: stamped.folio,
      serie: stamped.serie,
      emailSent: true,
    };
  } catch (e) {
    return {
      invoiceId,
      stamped: true,
      esPrueba: false,
      uuid: stamped.uuid,
      folio: stamped.folio,
      serie: stamped.serie,
      emailError: e instanceof Error ? e.message : 'No se pudo enviar el correo',
    };
  }
}
