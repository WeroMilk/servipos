import type { FormaPago, Sale } from '@/types';
import { FORMAS_PAGO } from '@/types';

/** Efectivo esperado en caja: fondo inicial + cobros en efectivo (01) − cambio entregado. */
export function computeCajaEfectivoEsperado(
  fondoInicial: number,
  ventasCompletadas: Sale[]
): { efectivoCobrado: number; cambioEntregado: number; esperadoEnCaja: number } {
  let efectivoCobrado = 0;
  let cambioEntregado = 0;
  for (const s of ventasCompletadas) {
    for (const p of s.pagos ?? []) {
      if (p.formaPago === '01') efectivoCobrado += Number(p.monto) || 0;
    }
    cambioEntregado += Number(s.cambio) || 0;
  }
  const esperadoEnCaja = fondoInicial + efectivoCobrado - cambioEntregado;
  return { efectivoCobrado, cambioEntregado, esperadoEnCaja };
}

export function filterVentasCompletadasSesion(ventas: Sale[]): Sale[] {
  return ventas.filter((s) => s.estado === 'completada');
}

export function resumenBrutoSesion(ventas: Sale[]): { tickets: number; total: number } {
  const ok = filterVentasCompletadasSesion(ventas);
  return {
    tickets: ok.length,
    total: ok.reduce((a, s) => a + (Number(s.total) || 0), 0),
  };
}

/** Suma de montos por clave de forma de pago (solo ventas completadas). */
export function totalesPorFormaPago(ventas: Sale[]): Partial<Record<FormaPago, number>> {
  const out: Partial<Record<FormaPago, number>> = {};
  for (const s of filterVentasCompletadasSesion(ventas)) {
    for (const p of s.pagos ?? []) {
      const k = p.formaPago;
      out[k] = (out[k] || 0) + (Number(p.monto) || 0);
    }
  }
  return out;
}

export function labelFormaPagoCaja(clave: string): string {
  const f = FORMAS_PAGO.find((x) => x.clave === clave);
  return f?.descripcion ?? clave;
}
