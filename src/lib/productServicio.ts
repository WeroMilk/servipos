import type { Product } from '@/types';

/** Servicios de taller / instalación: no llevan existencias físicas en inventario. */
export function productEsServicio(p: Pick<Product, 'esServicio' | 'categoria'>): boolean {
  if (p.esServicio === true) return true;
  return String(p.categoria ?? '').trim().toUpperCase() === 'SERVICIOS';
}
