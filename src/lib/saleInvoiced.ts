import type { Sale } from '@/types';

/** Venta vinculada a CFDI / marcada como facturada en el sistema. */
export function saleIsInvoiced(sale: Sale): boolean {
  if (sale.estado === 'facturada') return true;
  const id = sale.facturaId;
  return typeof id === 'string' && id.trim().length > 0;
}
