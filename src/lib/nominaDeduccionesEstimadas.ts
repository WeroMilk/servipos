import type { NominaPruebaLineaPercepcion } from '@/lib/cfdiRepresentacionImpresa';

/** Normaliza clave SAT (p. ej. "2" → "002"). */
export function normClaveNomina(clave: string): string {
  const t = clave.trim();
  if (!t) return '';
  const n = t.replace(/\D/g, '');
  if (!n) return t.toUpperCase();
  return n.padStart(3, '0');
}

/**
 * Base para estimación: suma de gravado + exento (total de percepciones del periodo).
 * Tasas derivadas del recibo de ejemplo (9,000 → ISR 1,240 · IMSS 285).
 */
export const TASA_ISR_ESTIMADA = 1240 / 9000;
export const TASA_IMSS_ESTIMADA = 285 / 9000;

export function totalPercepcionesGravadoExento(percepciones: NominaPruebaLineaPercepcion[]): number {
  return percepciones.reduce(
    (s, p) => s + (Number(p.gravado) || 0) + (Number(p.exento) || 0),
    0
  );
}

/** Redondeo a centavos (MXN). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estimarIsrImssDesdePercepciones(
  percepciones: NominaPruebaLineaPercepcion[]
): { isr: number; imss: number; base: number } {
  const base = totalPercepcionesGravadoExento(percepciones);
  if (base <= 0) return { isr: 0, imss: 0, base: 0 };
  return {
    base,
    isr: round2(base * TASA_ISR_ESTIMADA),
    imss: round2(base * TASA_IMSS_ESTIMADA),
  };
}
