import type { CajaSesion, FormaPago, Sale } from '@/types';
import { FORMAS_PAGO } from '@/types';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';

const FORMAS_SIN_COBRO_CIERRE = new Set<FormaPago>(['TTS', 'DEV', 'COT', 'PPC', 'STC']);

/** Estados que sí cuentan como venta cobrada para arqueo/cierre. */
function saleCuentaEnCaja(sale: Sale): boolean {
  return sale.estado === 'completada' || sale.estado === 'facturada';
}

function sumaMontosPagosRegistrados(pagos: Sale['pagos'] | undefined): number {
  return (pagos ?? []).reduce((a, p) => a + (Number(p.monto) || 0), 0);
}

/**
 * ¿Este pago cuenta en la sesión `sesionId`?
 * - Si el pago trae `cajaSesionId`, solo cuenta en esa sesión (abono/cobro el día que se pagó).
 * - Si no (legado), cuenta con la sesión de la venta.
 */
function pagoPerteneceASesion(
  sale: Pick<Sale, 'cajaSesionId'>,
  pago: { cajaSesionId?: string },
  sesionId: string
): boolean {
  const sid = sesionId.trim();
  if (!sid) return false;
  const paySid = (pago.cajaSesionId ?? '').trim();
  if (paySid) return paySid === sid;
  return (sale.cajaSesionId ?? '').trim() === sid;
}

/**
 * Líneas de cobro para arqueo y totales por forma de pago.
 * Prioriza `pagos` cuando traen montos. Si vienen vacíos o en cero (legado, sync incompleto, etc.),
 * infiere un cobro único como en el POS:
 * - **PUE + efectivo (01):** efectivo recibido = `total + cambio` (lo que entró al cajón antes del vuelto).
 * - **PUE + otra forma:** un pago por `total` (tarjeta, transferencia, …; cambio suele ser 0).
 * - **PPD** sin líneas: último recurso, un pago por `total` con `formaPago` de cabecera (mezclas mal guardadas pueden sesgar).
 *
 * Si se pasa `sesionId`, solo incluye cobros de esa sesión (el dinero se refleja el día que se cobró,
 * aunque la venta sea de otro turno).
 */
export function pagosParaResumenCaja(
  sale: Sale,
  sesionId?: string
): { formaPago: FormaPago; monto: number }[] {
  if (!saleCuentaEnCaja(sale)) return [];

  const sid = sesionId?.trim() || '';
  const registrados = sale.pagos ?? [];
  if (sumaMontosPagosRegistrados(registrados) > 0.01) {
    return registrados
      .filter((p) => p.esAbonoCxC !== true)
      .filter((p) => {
        if (sid) return pagoPerteneceASesion(sale, p, sid);
        // Sin sesión: no arrastrar a la venta cobros hechos en otro turno.
        const paySid = (p.cajaSesionId ?? '').trim();
        const saleSid = (sale.cajaSesionId ?? '').trim();
        if (paySid && saleSid && paySid !== saleSid) return false;
        return true;
      })
      .map((p) => ({
        formaPago: p.formaPago,
        monto: Number(p.monto) || 0,
      }));
  }

  // Inferencia solo si la venta pertenece a la sesión (o no filtramos por sesión).
  if (sid && (sale.cajaSesionId ?? '').trim() !== sid) return [];

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
 * Si se pasa `sesionId`, solo cuenta cobros de esa sesión (aunque la venta sea de otro día).
 */
export function computeCajaEfectivoEsperado(
  fondoInicial: number,
  ventasCompletadas: Sale[],
  sesionId?: string
): { efectivoCobrado: number; cambioEntregado: number; esperadoEnCaja: number } {
  let efectivoCobrado = 0;
  let cambioEntregado = 0;
  const sid = sesionId?.trim() || '';
  for (const s of ventasCompletadas) {
    for (const p of pagosParaResumenCaja(s, sid || undefined)) {
      if (p.formaPago === '01') efectivoCobrado += p.monto;
    }
    // El cambio solo descuenta si la venta es de esta sesión (o no filtramos).
    if (!sid || (s.cajaSesionId ?? '').trim() === sid) {
      cambioEntregado += Number(s.cambio) || 0;
    }
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
 * Efectivo esperado en cajón: ventas (fondo + cobros 01 − cambio) + aportes + abonos efectivo − retiros.
 */
export function efectivoEsperadoCajaSesion(
  esperadoBruto: number,
  aportesEfectivoTotal?: number | null,
  retirosEfectivoTotal?: number | null,
  abonosEfectivoTotal?: number | null
): number {
  const a = Math.max(0, Number(aportesEfectivoTotal) || 0);
  const ab = Math.max(0, Number(abonosEfectivoTotal) || 0);
  return efectivoEsperadoMenosRetiros(esperadoBruto + a + ab, retirosEfectivoTotal);
}

/** Suma de abonos CxC en efectivo (01) de la sesión. */
export function totalAbonosEfectivoSesion(
  abonos: { formaPago: FormaPago; monto: number }[] | undefined | null
): number {
  if (!abonos?.length) return 0;
  let t = 0;
  for (const a of abonos) {
    if (a.formaPago === '01') t += Number(a.monto) || 0;
  }
  return Math.round(t * 100) / 100;
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

/** Suma de montos por clave de forma de pago (ventas completadas + abonos CxC de la sesión). */
export function totalesPorFormaPago(
  ventas: Sale[],
  abonosCobros?: { formaPago: FormaPago; monto: number }[] | null,
  sesionId?: string
): Partial<Record<FormaPago, number>> {
  const out: Partial<Record<FormaPago, number>> = {};
  const sid = sesionId?.trim() || undefined;
  for (const s of filterVentasCompletadasSesion(ventas)) {
    for (const p of pagosParaResumenCaja(s, sid)) {
      const k = p.formaPago;
      out[k] = (out[k] || 0) + p.monto;
    }
  }
  for (const a of abonosCobros ?? []) {
    const k = a.formaPago;
    const m = Number(a.monto) || 0;
    if (!k || m <= 0) continue;
    out[k] = (out[k] || 0) + m;
  }
  return out;
}

export function labelFormaPagoCaja(clave: string): string {
  const f = FORMAS_PAGO.find((x) => x.clave === clave);
  return f?.descripcion ?? clave;
}

/** Filas ordenadas para ticket/UI de cierre (solo montos &gt; 0). */
export function lineasMediosPagoSesion(
  ventas: Sale[],
  abonosCobros?: { formaPago: FormaPago; monto: number }[] | null,
  sesionId?: string
): { clave: string; label: string; monto: number }[] {
  const porForma = totalesPorFormaPago(ventas, abonosCobros, sesionId);
  return Object.entries(porForma)
    .filter(([, m]) => (Number(m) || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, m]) => ({ clave, label: labelFormaPagoCaja(clave), monto: Number(m) || 0 }));
}

/** Agrupación típica de POS: efectivo, tarjetas SAT 04/28/29, resto de formas. */
export function resumenGruposMedioPagoCierre(
  ventas: Sale[],
  abonosCobros?: { formaPago: FormaPago; monto: number }[] | null,
  sesionId?: string
): {
  efectivoCobros: number;
  tarjetas: number;
  otros: number;
} {
  const por = totalesPorFormaPago(ventas, abonosCobros, sesionId);
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

export type SesionCierreMetrics = {
  tickets: number;
  totalVentasBruto: number;
  efectivoCobros: number;
  tarjetas: number;
  otros: number;
  saldoPendiente: number;
  ventasPendientes: number;
  ventasCanceladas: number;
  cambioEntregado: number;
  efectivoNetoVentas: number;
  abonosCobrosTotal: number;
  lineasMedio: { clave: string; label: string; monto: number }[];
};

/** Totales de ventas y medios de pago para un turno de caja (histórico o arqueo). */
export function computeSesionCierreMetrics(
  sesion: Pick<
    CajaSesion,
    'id' | 'fondoInicial' | 'aportesEfectivoTotal' | 'retirosEfectivoTotal' | 'abonosCobros'
  >,
  ventas: Sale[],
  /** Pool amplio de ventas (p. ej. catálogo reciente) para cobrar abonos de tickets de otros turnos. */
  ventasPoolCobros?: Sale[]
): SesionCierreMetrics {
  const completadas = filterVentasCompletadasSesion(ventas);
  const abonos = sesion.abonosCobros ?? [];
  const pool = ventasPoolCobros?.length ? ventasPoolCobros : ventas;
  const { tickets, total } = resumenBrutoSesion(ventas);
  const grupos = resumenGruposMedioPagoCierre(pool, abonos, sesion.id);
  const { efectivoCobrado, cambioEntregado } = computeCajaEfectivoEsperado(
    sesion.fondoInicial,
    filterVentasCompletadasSesion(pool),
    sesion.id
  );
  let saldoPendiente = 0;
  for (const s of completadas) {
    saldoPendiente += computeSaleClienteAdeudo(s);
  }
  const abonosCobrosTotal = Math.round(
    abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0) * 100
  ) / 100;
  return {
    tickets,
    totalVentasBruto: total,
    efectivoCobros: grupos.efectivoCobros,
    tarjetas: grupos.tarjetas,
    otros: grupos.otros,
    saldoPendiente: Math.round(saldoPendiente * 100) / 100,
    ventasPendientes: ventas.filter((s) => s.estado === 'pendiente').length,
    ventasCanceladas: ventas.filter((s) => s.estado === 'cancelada').length,
    cambioEntregado,
    efectivoNetoVentas: Math.round((efectivoCobrado - cambioEntregado) * 100) / 100,
    abonosCobrosTotal,
    lineasMedio: lineasMediosPagoSesion(pool, abonos, sesion.id),
  };
}
