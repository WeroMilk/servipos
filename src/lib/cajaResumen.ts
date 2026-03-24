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

/** Filas ordenadas para ticket/UI de cierre (solo montos &gt; 0). */
export function lineasMediosPagoSesion(ventas: Sale[]): { clave: string; label: string; monto: number }[] {
  const porForma = totalesPorFormaPago(ventas);
  return Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, m]) => ({ clave, label: labelFormaPagoCaja(clave), monto: Number(m) || 0 }));
}

/** Agrupación típica de POS: efectivo, tarjetas SAT 04/28/29, resto de formas. */
export function resumenGruposMedioPagoCierre(ventas: Sale[]): {
  efectivoCobros: number;
  tarjetas: number;
  otros: number;
} {
  const por = totalesPorFormaPago(ventas);
  const num = (clave: string) => Number(por[clave as FormaPago]) || 0;
  const efectivoCobros = num('01');
  const tarjetas = num('04') + num('28') + num('29');
  const yaEnResumen = new Set(['01', '04', '28', '29']);
  let otros = 0;
  for (const [k, v] of Object.entries(por)) {
    if (!yaEnResumen.has(k)) otros += Number(v) || 0;
  }
  return { efectivoCobros, tarjetas, otros };
}
