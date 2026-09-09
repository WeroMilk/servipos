import type { Invoice } from '@/types';
import { downloadInvoicePdfBase64FromFacturama } from '@/hooks/useFacturama';
import { printInvoiceCfdiRepresentacion } from '@/lib/cfdiRepresentacionImpresa';
import { pdfBase64ToUint8Array, uint8ArrayToPdfBlob } from '@/lib/pdfBase64';

export function pdfBase64ToBlob(b64: string): Blob {
  return uint8ArrayToPdfBlob(pdfBase64ToUint8Array(b64));
}

export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      iframe.remove();
      URL.revokeObjectURL(url);
      if (err) reject(err);
      else resolve();
    };
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        done(e instanceof Error ? e : new Error('No se pudo abrir la impresión del PDF'));
        return;
      }
      window.setTimeout(() => done(), 800);
    };
    iframe.onerror = () => done(new Error('No se pudo cargar el PDF oficial'));
    iframe.src = url;
  });
}

/** Imprime el PDF de Facturama (mismo que el correo). En modo prueba usa la carta local. */
export async function printInvoiceOfficialPdf(invoice: Invoice): Promise<void> {
  if (invoice.facturamaId) {
    const b64 = await downloadInvoicePdfBase64FromFacturama(invoice);
    await printPdfBlob(pdfBase64ToBlob(b64));
    return;
  }
  printInvoiceCfdiRepresentacion(invoice);
}
