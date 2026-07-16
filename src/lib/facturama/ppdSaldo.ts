import type { Invoice } from '@/types';

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
