import type { Invoice } from '@/types';

/** Factura PPD o forma 99 (Otros) con saldo: admite complemento de pago SAT. */
export function invoiceAceptaComplementoPago(invoice: Invoice): boolean {
  if (invoice.esPrueba) return false;
  if (!invoice.uuid?.trim()) return false;
  if (invoice.estado === 'cancelada' || invoice.estado === 'cancelacion_pendiente') return false;
  if (invoice.estado !== 'timbrada' && invoice.estado !== 'enviada') return false;
  const ppd = invoice.metodoPago === 'PPD' || invoice.formaPago === '99';
  if (!ppd) return false;
  return saldoInsolutoFacturaPpd(invoice) > 0.005;
}

/** Saldo insoluto de una factura PPD tras complementos de pago emitidos. */
export function saldoInsolutoFacturaPpd(invoice: Invoice): number {
  const total = Math.round((Number(invoice.total) || 0) * 100) / 100;
  const pagado = Math.round(
    (invoice.complementosPago ?? [])
      .filter((c) => c.estado === 'timbrada')
      .reduce((s, c) => s + (Number(c.monto) || 0), 0) * 100
  ) / 100;
  return Math.max(0, Math.round((total - pagado) * 100) / 100);
}

export function siguienteParcialidad(invoice: Invoice): number {
  const nums = (invoice.complementosPago ?? []).map((c) => Number(c.numeroParcialidad) || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
