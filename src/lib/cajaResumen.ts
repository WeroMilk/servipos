import type { CajaAbonoCobro, CajaSesion, FormaPago, Sale } from '@/types';
import { FORMAS_PAGO } from '@/types';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';
import { saleFechaHistorial } from '@/lib/saleHistorialFecha';
import { getMexicoDateKey } from '@/lib/quincenaMx';

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
      .filter((p) => p.formaPago !== 'STC')
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

export type GananciaSesionResult = {
  /** Suma (subtotal línea − costo × cantidad) sin IVA. */
  ganancia: number;
  /** Suma de subtotales de líneas (venta sin IVA). */
  ventaNeta: number;
  /** Suma de costo de compra × cantidad. */
  costoTotal: number;
  /** Líneas de tickets del turno sin costo en línea ni en catálogo. */
  lineasSinCosto: number;
  lineas: number;
};

/**
 * Ganancia bruta del turno: venta neta de líneas (subtotal) menos costo de compra.
 * `costByProductId` = catálogo actual; si la línea trae `precioCompra` se usa ese snapshot.
 */
export function computeGananciaSesion(
  ventas: Sale[],
  costByProductId?: Map<string, number> | Record<string, number> | null
): GananciaSesionResult {
  const lookup = (productId: string): number | undefined => {
    if (!costByProductId) return undefined;
    if (costByProductId instanceof Map) {
      const v = costByProductId.get(productId);
      return v != null && Number.isFinite(v) && v >= 0 ? v : undefined;
    }
    const v = costByProductId[productId];
    return v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  };

  let ganancia = 0;
  let ventaNeta = 0;
  let costoTotal = 0;
  let lineasSinCosto = 0;
  let lineas = 0;

  for (const sale of filterVentasCompletadasSesion(ventas)) {
    for (const line of sale.productos ?? []) {
      lineas += 1;
      const qty = Number(line.cantidad) || 0;
      const sub = Number(line.subtotal);
      const ingreso = Number.isFinite(sub)
        ? sub
        : (Number(line.precioUnitario) || 0) * qty * (1 - (Number(line.descuento) || 0) / 100);

      const snap = line.precioCompra != null ? Number(line.precioCompra) : NaN;
      const fromLine = Number.isFinite(snap) && snap >= 0 ? snap : undefined;
      const fromCat = lookup(String(line.productId ?? '').trim());
      const costoUnit = fromLine ?? fromCat;
      if (costoUnit == null) lineasSinCosto += 1;
      const costo = (costoUnit ?? 0) * qty;
      ventaNeta += ingreso;
      costoTotal += costo;
      ganancia += ingreso - costo;
    }
  }

  return {
    ganancia: Math.round(ganancia * 100) / 100,
    ventaNeta: Math.round(ventaNeta * 100) / 100,
    costoTotal: Math.round(costoTotal * 100) / 100,
    lineasSinCosto,
    lineas,
  };
}

/** Importe cobrado de una venta (excluye `esAbonoCxC`; esos van por `abonosCobros`). */
export function cobradoEnVenta(sale: Sale, sesionId?: string): number {
  const t = pagosParaResumenCaja(sale, sesionId).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.round(t * 100) / 100;
}

export function totalAbonosCobros(
  abonos: { monto: number }[] | undefined | null
): number {
  if (!abonos?.length) return 0;
  return Math.round(abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0) * 100) / 100;
}

function abonoFingerprint(a: {
  monto: number;
  formaPago: string;
  clienteId?: string;
  createdAt?: Date | string;
}): string {
  const cents = Math.round((Number(a.monto) || 0) * 100);
  const day =
    a.createdAt instanceof Date
      ? a.createdAt.toISOString().slice(0, 10)
      : typeof a.createdAt === 'string' && a.createdAt.length >= 10
        ? a.createdAt.slice(0, 10)
        : '';
  return `${(a.clienteId ?? '').trim()}|${a.formaPago}|${cents}|${day}`;
}

/**
 * Une abonos guardados en la sesión con los recuperables desde tickets (`esAbonoCxC`)
 * o historial de clientes. Evita perder el corte si el RPC de caja falló tras guardar CxC.
 *
 * Fuente canónica: `sesion.abonosCobros` (o historial si la sesión está vacía).
 * Los pagos `esAbonoCxC` en tickets solo se usan como respaldo cuando no hay cobertura
 * canónica del mismo cliente en la sesión (evita duplicar total $561 + parciales $546+$15).
 */
export function resolveAbonosCobrosSesion(
  sesion: Pick<CajaSesion, 'id' | 'abonosCobros'>,
  ventasPool?: Sale[] | null,
  abonosExtra?: CajaAbonoCobro[] | null
): CajaAbonoCobro[] {
  const sid = sesion.id.trim();
  const out: CajaAbonoCobro[] = [];
  const ids = new Set<string>();
  const fps = new Set<string>();
  const clientesCanon = new Set<string>();

  const push = (a: CajaAbonoCobro) => {
    const monto = Math.round((Number(a.monto) || 0) * 100) / 100;
    if (monto <= 0.005 || !a.formaPago) return;
    const id = (a.id || '').trim();
    const fp = abonoFingerprint({ ...a, monto });
    if ((id && ids.has(id)) || fps.has(fp)) return;
    if (id) ids.add(id);
    fps.add(fp);
    const cid = (a.clienteId ?? '').trim();
    if (cid) clientesCanon.add(cid);
    out.push({ ...a, monto, cajaSesionId: a.cajaSesionId?.trim() || sid });
  };

  const sesionAbonos = sesion.abonosCobros ?? [];
  for (const a of sesionAbonos) push(a);

  // Historial: respaldo de IDs/montos no cubiertos (dedupe por fingerprint / id).
  for (const a of abonosExtra ?? []) push(a);

  // Tickets esAbonoCxC: solo si ese cliente aún no tiene abono canónico (sesión o historial).
  for (const sale of ventasPool ?? []) {
    for (const p of sale.pagos ?? []) {
      if (p.esAbonoCxC !== true) continue;
      if (!pagoPerteneceASesion(sale, p, sid)) continue;
      const monto = Math.round((Number(p.monto) || 0) * 100) / 100;
      if (monto <= 0.005) continue;
      const clienteId = sale.clienteId && sale.clienteId !== 'mostrador' ? sale.clienteId : undefined;
      if (clienteId && clientesCanon.has(clienteId)) continue;
      push({
        id: `pago:${sale.id}:${p.id}`,
        monto,
        formaPago: p.formaPago,
        clienteId,
        clienteNombre: sale.cliente?.nombre,
        createdAt: sale.completedAt ?? sale.updatedAt ?? sale.createdAt,
        usuarioId: sale.usuarioId || '',
        usuarioNombre: sale.usuarioNombre?.trim() || 'Ticket',
        cajaSesionId: sid,
      });
    }
  }

  out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return out;
}

/**
 * Criterio de caja / cobrado del periodo:
 * pagos de ventas del periodo (sin abonos CxC) + abonos CxC cobrados en el periodo.
 * El bruto de tickets (`totalVentasBruto`) se mantiene aparte para no duplicar ingresos.
 */
export function computeCobradoPeriodo(
  ventas: Sale[],
  abonosCobros?: { formaPago: FormaPago; monto: number }[] | null,
  sesionId?: string
): {
  cobradoTotal: number;
  cobradoVentas: number;
  cobradoAbonos: number;
  movimientos: number;
  porForma: Partial<Record<FormaPago, number>>;
  efectivo: number;
  tarjetas: number;
  otros: number;
} {
  const porForma = totalesPorFormaPago(ventas, abonosCobros, sesionId);
  let cobradoVentas = 0;
  for (const s of filterVentasCompletadasSesion(ventas)) {
    cobradoVentas += cobradoEnVenta(s, sesionId);
  }
  cobradoVentas = Math.round(cobradoVentas * 100) / 100;
  const cobradoAbonos = totalAbonosCobros(abonosCobros);
  const cobradoTotal = Math.round((cobradoVentas + cobradoAbonos) * 100) / 100;
  const grupos = resumenGruposMedioPagoCierre(ventas, abonosCobros, sesionId);
  const movimientos =
    filterVentasCompletadasSesion(ventas).filter((s) => cobradoEnVenta(s, sesionId) > 0.005).length +
    (abonosCobros?.filter((a) => (Number(a.monto) || 0) > 0.005).length ?? 0);
  return {
    cobradoTotal,
    cobradoVentas,
    cobradoAbonos,
    movimientos,
    porForma,
    efectivo: grupos.efectivoCobros,
    tarjetas: grupos.tarjetas,
    otros: grupos.otros,
  };
}

/** Fila unificada para historial / reporte: venta del día o abono cobrado ese día. */
export type HistorialCobroMovimiento =
  | {
      kind: 'venta';
      id: string;
      at: Date;
      monto: number;
      sale: Sale;
    }
  | {
      kind: 'abono';
      id: string;
      at: Date;
      monto: number;
      abono: CajaAbonoCobro;
    };

/** Mezcla ventas (por fecha de historial) y abonos (por fecha de pago), más recientes primero. */
export function buildHistorialCobrosMovimientos(
  ventas: Sale[],
  abonos: CajaAbonoCobro[] | undefined | null
): HistorialCobroMovimiento[] {
  const rows: HistorialCobroMovimiento[] = [];
  for (const sale of ventas) {
    if (sale.estado === 'cancelada') continue;
    const at = saleFechaHistorial(sale);
    const monto =
      sale.estado === 'pendiente'
        ? 0
        : cobradoEnVenta(sale);
    rows.push({
      kind: 'venta',
      id: `venta:${sale.id}`,
      at,
      monto,
      sale,
    });
  }
  for (const abono of abonos ?? []) {
    const monto = Math.round((Number(abono.monto) || 0) * 100) / 100;
    if (monto <= 0) continue;
    const at =
      abono.createdAt instanceof Date ? abono.createdAt : new Date(abono.createdAt);
    rows.push({
      kind: 'abono',
      id: `abono:${abono.id}`,
      at,
      monto,
      abono,
    });
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  return rows;
}

/** Cobrado de un día (ventas con fecha historial en el día + abonos con createdAt en el día). */
export function cobradoEnDia(
  ventasDelDia: Sale[],
  abonosDelDia: CajaAbonoCobro[] | undefined | null
): number {
  return computeCobradoPeriodo(ventasDelDia, abonosDelDia).cobradoTotal;
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
    if (!k || m <= 0 || k === 'STC') continue;
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

/** Agrupación típica de POS: efectivo, tarjetas SAT 04/28/29, resto de formas (sin STC). */
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
  const yaEnResumen = new Set(['01', '04', '28', '29', 'STC']);
  let otros = 0;
  for (const [k, v] of Object.entries(por)) {
    if (!yaEnResumen.has(k)) otros += Number(v) || 0;
  }
  return { efectivoCobros, tarjetas, otros };
}

/** Pagos STC del turno (cliente usó crédito de tienda). */
export function sumCreditoTiendaUsadoSesion(ventas: Sale[], sesionId?: string): number {
  const sid = sesionId?.trim() || '';
  let sum = 0;
  for (const s of filterVentasCompletadasSesion(ventas)) {
    for (const p of s.pagos ?? []) {
      if (p.formaPago !== 'STC') continue;
      if (p.esAbonoCxC === true) continue;
      const m = Number(p.monto) || 0;
      if (m <= 0) continue;
      if (sid) {
        if (!pagoPerteneceASesion(s, p, sid)) continue;
      } else {
        const paySid = (p.cajaSesionId ?? '').trim();
        const saleSid = (s.cajaSesionId ?? '').trim();
        if (paySid && saleSid && paySid !== saleSid) continue;
      }
      sum += m;
    }
  }
  return Math.round(sum * 100) / 100;
}

export function totalCreditosTiendaEmitidosSesion(
  emitidos: CajaSesion['creditosTiendaEmitidos'] | null | undefined
): number {
  const t = (emitidos ?? []).reduce((s, e) => s + (Number(e.monto) || 0), 0);
  return Math.round(t * 100) / 100;
}

export type SesionCierreMetrics = {
  tickets: number;
  totalVentasBruto: number;
  /** Cobrado real del turno (pagos de ventas + abonos CxC), sin duplicar. */
  totalCobrado: number;
  efectivoCobros: number;
  tarjetas: number;
  otros: number;
  saldoPendiente: number;
  ventasPendientes: number;
  ventasCanceladas: number;
  cambioEntregado: number;
  efectivoNetoVentas: number;
  abonosCobrosTotal: number;
  /** Cliente pagó con saldo a favor (STC). */
  creditoTiendaUsado: number;
  /** Tienda otorgó crédito (devolución sin efectivo / emisión manual). */
  creditoTiendaEmitido: number;
  lineasMedio: { clave: string; label: string; monto: number }[];
};

/** Totales de ventas y medios de pago para un turno de caja (histórico o arqueo). */
export function computeSesionCierreMetrics(
  sesion: Pick<
    CajaSesion,
    | 'id'
    | 'fondoInicial'
    | 'aportesEfectivoTotal'
    | 'retirosEfectivoTotal'
    | 'abonosCobros'
    | 'creditosTiendaEmitidos'
  >,
  ventas: Sale[],
  /** Pool amplio de ventas (p. ej. catálogo reciente) para cobrar abonos de tickets de otros turnos. */
  ventasPoolCobros?: Sale[],
  /** Abonos recuperados del historial de clientes u otras fuentes. */
  abonosExtra?: CajaAbonoCobro[] | null
): SesionCierreMetrics {
  const completadas = filterVentasCompletadasSesion(ventas);
  const pool = ventasPoolCobros?.length ? ventasPoolCobros : ventas;
  const abonos = resolveAbonosCobrosSesion(sesion, pool, abonosExtra);
  const { tickets, total } = resumenBrutoSesion(ventas);
  const cobrado = computeCobradoPeriodo(filterVentasCompletadasSesion(pool), abonos, sesion.id);
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
  const abonosCobrosTotal = cobrado.cobradoAbonos;
  return {
    tickets,
    totalVentasBruto: total,
    totalCobrado: cobrado.cobradoTotal,
    efectivoCobros: grupos.efectivoCobros,
    tarjetas: grupos.tarjetas,
    otros: grupos.otros,
    saldoPendiente: Math.round(saldoPendiente * 100) / 100,
    ventasPendientes: ventas.filter((s) => s.estado === 'pendiente').length,
    ventasCanceladas: ventas.filter((s) => s.estado === 'cancelada').length,
    cambioEntregado,
    efectivoNetoVentas: Math.round((efectivoCobrado - cambioEntregado) * 100) / 100,
    abonosCobrosTotal,
    creditoTiendaUsado: sumCreditoTiendaUsadoSesion(pool, sesion.id),
    creditoTiendaEmitido: totalCreditosTiendaEmitidosSesion(sesion.creditosTiendaEmitidos),
    lineasMedio: lineasMediosPagoSesion(pool, abonos, sesion.id),
  };
}

/** Total declarado de cortes de terminal de un turno (o null si no hay dato). */
export function tarjetaFisicoDeSesion(sesion: Pick<CajaSesion, 'conteoTarjetasDeclarado' | 'cierresTerminal'>): number | null {
  if (sesion.conteoTarjetasDeclarado != null && Number.isFinite(Number(sesion.conteoTarjetasDeclarado))) {
    return Math.round(Number(sesion.conteoTarjetasDeclarado) * 100) / 100;
  }
  const cierres = sesion.cierresTerminal ?? [];
  if (!cierres.length) return null;
  const sum = cierres.reduce((s, c) => s + (Number(c.total) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/** Total POS (sistema) de tarjetas guardado al cierre; `liveTarjetas` para turno abierto. */
export function tarjetaSistemaDeSesion(
  sesion: Pick<CajaSesion, 'tarjetasEsperadas'>,
  liveTarjetas?: number | null
): number {
  if (liveTarjetas != null && Number.isFinite(liveTarjetas)) {
    return Math.round(liveTarjetas * 100) / 100;
  }
  if (sesion.tarjetasEsperadas != null && Number.isFinite(Number(sesion.tarjetasEsperadas))) {
    return Math.round(Number(sesion.tarjetasEsperadas) * 100) / 100;
  }
  return 0;
}

export type ResumenTarjetasPeriodo = {
  sistema: number;
  fisico: number;
  /** Turnos con al menos un corte / conteo físico. */
  turnosConFisico: number;
  turnos: number;
  /** Sesiones sin `tarjetasEsperadas` ni override (dato incompleto). */
  turnosSinSistema: number;
  diferencia: number | null;
};

/**
 * Suma cobros con tarjeta (sistema) y cortes físicos de turnos en un rango de fechas MX.
 * `liveBySesionId` permite inyectar el total en vivo del turno abierto.
 */
export function resumenTarjetasPeriodo(
  sesiones: CajaSesion[],
  opts: {
    /** Incluir sesión si `getMexicoDateKey(openedAt)` está en este set, o empieza con `monthKey`. */
    dateKeys?: ReadonlySet<string>;
    monthKey?: string;
    liveBySesionId?: Record<string, number> | Map<string, number> | null;
  }
): ResumenTarjetasPeriodo {
  const monthKey = opts.monthKey?.trim() || '';
  const dateKeys = opts.dateKeys;
  const live = opts.liveBySesionId;

  const getLive = (id: string): number | undefined => {
    if (!live) return undefined;
    if (live instanceof Map) {
      const v = live.get(id);
      return v != null && Number.isFinite(v) ? v : undefined;
    }
    const v = live[id];
    return v != null && Number.isFinite(v) ? v : undefined;
  };

  let sistema = 0;
  let fisico = 0;
  let turnos = 0;
  let turnosConFisico = 0;
  let turnosSinSistema = 0;

  for (const s of sesiones) {
    const dk = getMexicoDateKey(s.openedAt);
    if (dateKeys && !dateKeys.has(dk)) continue;
    if (monthKey && !dk.startsWith(monthKey)) continue;
    turnos += 1;
    const liveT = getLive(s.id);
    const hasStored =
      s.tarjetasEsperadas != null && Number.isFinite(Number(s.tarjetasEsperadas));
    if (liveT == null && !hasStored) turnosSinSistema += 1;
    sistema += tarjetaSistemaDeSesion(s, liveT ?? null);
    const fis = tarjetaFisicoDeSesion(s);
    if (fis != null) {
      fisico += fis;
      turnosConFisico += 1;
    }
  }

  const sistemaR = Math.round(sistema * 100) / 100;
  const fisicoR = Math.round(fisico * 100) / 100;
  return {
    sistema: sistemaR,
    fisico: fisicoR,
    turnosConFisico,
    turnos,
    turnosSinSistema,
    diferencia: turnosConFisico > 0 ? Math.round((fisicoR - sistemaR) * 100) / 100 : null,
  };
}
