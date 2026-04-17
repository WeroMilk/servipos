import type { Sale } from '@/types';

/** Ventas que cuentan como compra del cliente (listado y contador `ventasHistorial`). Excluye canceladas. */
export function saleCuentaComoCompraCliente(sale: Sale): boolean {
  return sale.estado !== 'cancelada';
}
