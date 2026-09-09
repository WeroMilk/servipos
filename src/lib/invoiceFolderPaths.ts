import type { Invoice } from '@/types';

export const FACTURAS_SERVIPARTZ_ROOT = 'Facturas Servipartz';

export function sanitizeFolderName(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Cliente').slice(0, 80);
}

export function invoiceClientFolderName(invoice: Invoice): string {
  const name =
    invoice.cliente?.razonSocial?.trim() ||
    invoice.cliente?.nombre?.trim() ||
    'Cliente';
  return sanitizeFolderName(name);
}

export function invoiceDateFolderName(invoice: Invoice): string {
  const d = invoice.fechaTimbrado ?? invoice.fechaEmision ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function invoiceCfdiFileBaseName(invoice: Invoice): string {
  const serie = sanitizeFolderName(String(invoice.serie || 'A'));
  const folio = sanitizeFolderName(String(invoice.folio || invoice.id || 'folio'));
  return `CFDI_${serie}_${folio}`;
}

export function invoiceServipartzRelativeDir(invoice: Invoice): string {
  return `${FACTURAS_SERVIPARTZ_ROOT}/${invoiceClientFolderName(invoice)}/${invoiceDateFolderName(invoice)}`;
}
