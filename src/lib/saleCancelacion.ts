import type { Sale } from '@/types';

/** Texto en listados (panel, historial). */
export function saleListaCancelacionEtiqueta(sale: Sale): string | null {
  if (sale.estado !== 'cancelada') return null;
  if (sale.cancelacionMotivo === 'devolucion') return 'Cancelado por devolución';
  return 'Venta cancelada';
}

/** Leyenda en ticket térmico (reimpresión). */
export function thermalTicketCancelacionNotas(sale: Sale): string | undefined {
  if (sale.estado !== 'cancelada') return undefined;
  if (sale.cancelacionMotivo === 'devolucion') return 'CANCELADO POR DEVOLUCIÓN';
  return 'VENTA CANCELADA';
}
