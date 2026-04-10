import type { FormaPago, Sale } from '@/types';
import { FORMAS_PAGO } from '@/types';

const FORMAS_SIN_COBRO_CIERRE = new Set<FormaPago>(['TTS', 'DEV', 'COT', 'PPC']);

/** Estados que sí cuentan como venta cobrada para arqueo/cierre. */
function saleCuentaEnCaja(sale: Sale): boolean {
  return sale.estado === 'completada' || sale.estado === 'facturada';
}

function sumaMontosPagosRegistrados(pagos: Sale['pagos'] | undefined): number {
  return (pagos ?? []).reduce((a, p) => a + (Number(p.monto) || 0), 0);
}

/**
 * Líneas de cobro para arqueo y totales por forma de pago.
 * Prioriza `pagos` cuando traen montos. Si vienen vacíos o en cero (legado, sync incompleto, etc.),
 * infiere un cobro único como en el POS:
 * - **PUE + efectivo (01):** efectivo recibido = `total + cambio` (lo que entró al cajón antes del vuelto).
 * - **PUE + otra forma:** un pago por `total` (tarjeta, transferencia, …; cambio suele ser 0).
 * - **PPD** sin líneas: último recurso, un pago por `total` con `formaPago` de cabecera (mezclas mal guardadas pueden sesgar).
 */
export function pagosParaResumenCaja(sale: Sale): { formaPago: FormaPago; monto: number }[] {
  if (!saleCuentaEnCaja(sale)) return [];

  const registrados = sale.pagos ?? [];
  if (sumaMontosPagosRegistrados(registrados) > 0.01) {
    return registrados.map((p) => ({
      formaPago: p.formaPago,
      monto: Number(p.monto) || 0,
    }));
  }

  const fp = sale.formaPago;
  if (FORMAS_SIN_COBRO_CIERRE.has(fp)) return [];

  const total = Number(sale.total) || 0;
  const cambio = Number(sale.cambio) || 0;
  if (total <= 0.01 && cambio <= 0.01) return [];

  const esPpd = sale.metodoPago === 'PPD';

  if (!esPpd) {
    if (fp === '01') {
      const recibido = total + cambio;
      if (recibido > 0.01) return [{ formaPago: '01', monto: recibido }];
      return total > 0.01 ? [{ formaPago: '01', monto: total }] : [];
    }
    return total > 0.01 ? [{ formaPago: fp, monto: total }] : [];
  }

  if (total > 0.01) return [{ formaPago: fp, monto: total }];
  return [];
}

/**
 * Efectivo esperado en caja: fondo + cobros en forma 01 − vueltos (`cambio`).
 * En pantalla de arqueo se muestra como fondo + (efectivoCobrado − cambioEntregado) sin desglosar el cambio.
 */
export function computeCajaEfectivoEsperado(
  fondoInicial: number,
  ventasCompletadas: Sale[]
): { efectivoCobrado: number; cambioEntregado: number; esperadoEnCaja: number } {
  let efectivoCobrado = 0;
  let cambioEntregado = 0;
  for (const s of ventasCompletadas) {
    for (const p of pagosParaResumenCaja(s)) {
      if (p.formaPago === '01') efectivoCobrado += p.monto;
    }
    cambioEntregado += Number(s.cambio) || 0;
  }
  const esperadoEnCaja = fondoInicial + efectivoCobrado - cambioEntregado;
  return { efectivoCobrado, cambioEntregado, esperadoEnCaja };
}

/** Efectivo esperado tras descontar retiros a bóveda/banco registrados en la sesión. */
export function efectivoEsperadoMenosRetiros(
  esperadoBruto: number,
  retirosEfectivoTotal: number | undefined | null
): number {
  const r = Math.max(0, Number(retirosEfectivoTotal) || 0);
  return Math.round((esperadoBruto - r) * 100) / 100;
}

/**
 * Efectivo esperado en cajón: ventas (fondo + cobros 01 − cambio) + aportes de sesión − retiros.
 */
export function efectivoEsperadoCajaSesion(
  esperadoBruto: number,
  aportesEfectivoTotal?: number | null,
  retirosEfectivoTotal?: number | null
): number {
  const a = Math.max(0, Number(aportesEfectivoTotal) || 0);
  return efectivoEsperadoMenosRetiros(esperadoBruto + a, retirosEfectivoTotal);
}

export function filterVentasCompletadasSesion(ventas: Sale[]): Sale[] {
  return ventas.filter((s) => saleCuentaEnCaja(s));
}

/**
 * Efectivo neto que la venta dejó en caja (cobros en 01 menos cambio). Al cancelar la venta,
 * el **efectivo esperado** del cierre baja en este monto: el cajero debe **devolver al cliente**
 * esa cantidad si aplica.
 */
export function efectivoNetoEnCajaPorVenta(sale: Sale): number {
  if (!saleCuentaEnCaja(sale)) return 0;
  let cobroEfectivo = 0;
  for (const p of pagosParaResumenCaja(sale)) {
    if (p.formaPago === '01') cobroEfectivo += p.monto;
  }
  const cambio = Number(sale.cambio) || 0;
  return Math.round((cobroEfectivo - cambio) * 100) / 100;
}

/** Cobros distintos de efectivo (para avisar que no hay devolución en caja desde este ticket). */
export function cobrosNoEfectivoResumen(sale: Sale): { clave: FormaPago; monto: number }[] {
  if (!saleCuentaEnCaja(sale)) return [];
  const out: { clave: FormaPago; monto: number }[] = [];
  for (const p of pagosParaResumenCaja(sale)) {
    if (p.formaPago !== '01' && p.monto > 0.005) out.push({ clave: p.formaPago, monto: p.monto });
  }
  return out;
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
    for (const p of pagosParaResumenCaja(s)) {
      const k = p.formaPago;
      out[k] = (out[k] || 0) + p.monto;
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
