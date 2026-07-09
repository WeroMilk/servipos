import type { Client, ClientCreditoHistorialEntry, Payment } from '@/types';

export const CREDITO_TIENDA_MOTIVOS_EMISION = [
  { id: 'devolucion_sin_reembolso', label: 'Devolución sin reembolso en efectivo' },
  { id: 'cambio_articulo', label: 'Cambio de artículo / nota de crédito' },
  { id: 'cortesia_tienda', label: 'Cortesía o compensación de tienda' },
  { id: 'ajuste_manual', label: 'Ajuste manual' },
] as const;

export type CreditoTiendaMotivoEmisionId = (typeof CREDITO_TIENDA_MOTIVOS_EMISION)[number]['id'];

export function saldoCreditoCliente(c: Pick<Client, 'saldoCreditoTienda'> | null | undefined): number {
  const v = Number(c?.saldoCreditoTienda);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

export function labelCreditoTiendaMotivo(motivo?: string | null): string {
  const id = (motivo ?? '').trim();
  const hit = CREDITO_TIENDA_MOTIVOS_EMISION.find((m) => m.id === id);
  if (hit) return hit.label;
  if (id) return id;
  return 'Crédito de tienda';
}

export function labelCreditoTiendaTipo(tipo: ClientCreditoHistorialEntry['tipo']): string {
  if (tipo === 'emision') return 'Emisión';
  if (tipo === 'uso') return 'Uso en venta';
  return 'Ajuste';
}

/** Suma importes pagados con crédito de tienda (forma STC). */
export function sumCreditoTiendaEnPagos(pagos: readonly Payment[] | undefined): number {
  if (!pagos?.length) return 0;
  const sum = pagos
    .filter((p) => p.formaPago === 'STC')
    .reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.round(sum * 100) / 100;
}

export function sumCreditoTiendaEnPagosParcial(
  pagos: readonly Pick<Payment, 'formaPago' | 'monto'>[] | undefined
): number {
  if (!pagos?.length) return 0;
  const sum = pagos
    .filter((p) => p.formaPago === 'STC')
    .reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.round(sum * 100) / 100;
}

export function labelFormaPagoIncluyeStc(clave: string): string {
  if (clave === 'STC') return 'Crédito de tienda';
  return clave;
}
