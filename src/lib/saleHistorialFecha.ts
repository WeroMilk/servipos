import type { Sale } from '@/types';

function toDate(v: Date | string | undefined): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date();
}

/** Fecha con la que la venta debe aparecer en listados / reimpresión del día. */
export function saleFechaHistorial(sale: Sale): Date {
  const created = toDate(sale.createdAt);
  if (sale.estado === 'pendiente') return created;
  if (sale.completedAt) return toDate(sale.completedAt);
  return created;
}

export function saleEnRangoHistorial(sale: Sale, inicio: Date, finExclusive: Date): boolean {
  const t = saleFechaHistorial(sale).getTime();
  return t >= inicio.getTime() && t < finExclusive.getTime();
}
