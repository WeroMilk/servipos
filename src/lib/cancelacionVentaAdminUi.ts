import type { Sale } from '@/types';
import { formatMoney } from '@/lib/utils';
import { cobrosNoEfectivoResumen, efectivoNetoEnCajaPorVenta, labelFormaPagoCaja } from '@/lib/cajaResumen';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';

/** Párrafos para diálogos de cancelación (admin): inventario, dinero, caja, cuenta cliente. */
export function parrafosAyudaCancelacionVentaAdmin(sale: Sale): string[] {
  const lines: string[] = [
    'Se reintegra la mercancía al inventario (entradas de stock por cada línea).',
  ];

  const ef = efectivoNetoEnCajaPorVenta(sale);
  const otros = cobrosNoEfectivoResumen(sale);

  if (ef > 0.005) {
    lines.push(
      `Efectivo a devolver al cliente: ${formatMoney(ef)}. Al excluir la venta, el efectivo esperado en cierre de caja baja en ese monto (el dinero debe salir del cajón).`
    );
  } else if (otros.length > 0) {
    const det = otros
      .map((o) => `${labelFormaPagoCaja(o.clave)} ${formatMoney(o.monto)}`)
      .join(', ');
    lines.push(
      `Cobro con medios distintos de efectivo (${det}). El reembolso debe gestionarse aparte (terminal, transferencia devuelta, etc.); el arqueo de efectivo no refleja esos montos.`
    );
  } else if (sale.estado === 'completada') {
    lines.push(
      'Sin líneas de pago con monto en este ticket: revise si el cobro quedó incompleto en el registro.'
    );
  }

  const adeudo = computeSaleClienteAdeudo(sale);
  if (adeudo > 0.005) {
    lines.push(`Saldo pendiente del cliente: se reduce en ${formatMoney(adeudo)} (cuentas por cobrar).`);
  }

  lines.push('El ticket queda en estado cancelado; no se borra el historial.');

  return lines;
}
