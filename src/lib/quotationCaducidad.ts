import type { Quotation } from '@/types';

export function quotationVigenciaTs(q: Quotation): number {
  const d = q.fechaVigencia;
  return d instanceof Date ? d.getTime() : new Date(d as string).getTime();
}

/** Cotizaciones que ya no deben mostrarse: caducadas o marcadas vencida/rechazada (salvo ya cobradas). */
export function cotizacionDebeEliminarsePorCaducidad(q: Quotation): boolean {
  if (q.estado === 'convertida') return false;
  if (q.estado === 'vencida' || q.estado === 'rechazada') return true;
  return quotationVigenciaTs(q) < Date.now();
}
