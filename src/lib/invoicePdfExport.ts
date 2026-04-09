import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { Invoice } from '@/types';
import { buildInvoiceCfdiPrintDocumentHtml } from '@/lib/cfdiRepresentacionImpresa';

/**
 * Genera un PDF con el mismo diseño que la representación impresa (plantilla clásica),
 * capturando el HTML con html2canvas para que coincida con «Imprimir (carta)».
 */
export async function exportInvoiceCfdiToPdf(
  invoice: Invoice,
  fileBaseName = `Factura_${invoice.serie}_${invoice.folio}`
): Promise<void> {
  const html = await buildInvoiceCfdiPrintDocumentHtml(invoice);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:816px;min-height:1100px;height:auto;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const frameDoc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  frameDoc.open();
  const htmlUtf8 = html.startsWith('\uFEFF') ? html : `\uFEFF${html}`;
  frameDoc.write(htmlUtf8);
  frameDoc.close();

  await new Promise<void>((resolve) => {
    if (frameDoc.readyState === 'complete') resolve();
    else win.addEventListener('load', () => resolve(), { once: true });
  });

  await Promise.all(
    [...frameDoc.images].map(
      (img) =>
        new Promise<void>((res) => {
          if (img.complete) res();
          else {
            img.onload = () => res();
            img.onerror = () => res();
          }
        })
    )
  );

  await new Promise<void>((r) => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  });

  const body = frameDoc.body;
  const canvas = await html2canvas(body, {
    scale: 1.75,
    useCORS: true,
    logging: false,
    windowWidth: body.scrollWidth,
    windowHeight: body.scrollHeight,
    backgroundColor: '#ffffff',
  });

  iframe.remove();

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  let drawW = maxW;
  let drawH = (canvas.height * drawW) / canvas.width;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = (canvas.width * drawH) / canvas.height;
  }
  const x = (pageW - drawW) / 2;
  const y = margin;

  pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH);

  const name = fileBaseName.endsWith('.pdf') ? fileBaseName : `${fileBaseName}.pdf`;
  pdf.save(name);
}
