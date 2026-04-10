import type { Sale } from '@/types';

/** Evita saldo fantasma en CxC por redondeo de varios abonos o IVA (p. ej. $0.01). */
const ADEUDO_FLOAT_EPS = 0.02;

/** Importe que el cliente aún debe por la venta (total − pagos recibidos), solo ventas cobradas. */
export function computeSaleClienteAdeudo(sale: Pick<Sale, 'total' | 'pagos' | 'estado'>): number {
  if (sale.estado === 'pendiente' || sale.estado === 'cancelada') return 0;
  const paid = (sale.pagos ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const tot = Number(sale.total) || 0;
  const raw = tot - paid;
  if (raw <= ADEUDO_FLOAT_EPS) return 0;
  return Math.max(0, Math.round(raw * 100) / 100);
}
