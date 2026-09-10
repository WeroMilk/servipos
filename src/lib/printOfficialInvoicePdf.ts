import type { Invoice } from '@/types';
import { downloadInvoicePdfBase64FromFacturama } from '@/hooks/useFacturama';
import { printInvoiceCfdiRepresentacion } from '@/lib/cfdiRepresentacionImpresa';
import { pdfBase64ToUint8Array, uint8ArrayToPdfBlob } from '@/lib/pdfBase64';

export function pdfBase64ToBlob(b64: string): Blob {
  return uint8ArrayToPdfBlob(pdfBase64ToUint8Array(b64));
}

/**
 * Abre el PDF oficial y dispara impresión. No se cierra a los pocos ms:
 * el visor de Chrome/Acrobat cancelaba el diálogo si se destruía el iframe.
 */
export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, 'servipos-factura-pdf', 'width=816,height=1056');
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error(
      'El navegador bloqueó la ventana de impresión. Permita ventanas emergentes y vuelva a imprimir.'
    );
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (!w.closed) w.close();
    } catch {
      /* noop */
    }
    URL.revokeObjectURL(url);
  };

  let printStarted = false;
  const tryPrint = () => {
    if (printStarted || w.closed) return;
    printStarted = true;
    try {
      w.focus();
      w.print();
    } catch {
      /* visor PDF nativo: el usuario imprime con Ctrl+P */
    }
  };

  w.addEventListener('afterprint', cleanup, { once: true });
  w.addEventListener('pagehide', () => {
    if (!cleaned) {
      cleaned = true;
      URL.revokeObjectURL(url);
    }
  });
  w.addEventListener('load', () => {
    window.setTimeout(tryPrint, 600);
  });
  window.setTimeout(tryPrint, 1200);
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
