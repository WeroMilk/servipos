import type { Client, Sale } from '@/types';

/** Ventas que cuentan como compra del cliente (listado y contador `ventasHistorial`). Excluye canceladas. */
export function saleCuentaComoCompraCliente(sale: Sale): boolean {
  return sale.estado !== 'cancelada';
}

/** Conteo por cliente a partir de ventas cargadas (misma regla que el historial del cliente). */
export function buildComprasCountByCliente(sales: Sale[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const sale of sales) {
    if (!saleCuentaComoCompraCliente(sale)) continue;
    const clientId = (sale.clienteId ?? '').trim();
    if (!clientId || clientId === 'mostrador') continue;
    map.set(clientId, (map.get(clientId) ?? 0) + 1);
  }
  return map;
}

/** Número mostrado en el botón de ticket: ventas reales cargadas; si no hay datos, `ventasHistorial` o `ticketsComprados`. */
export function ticketsHistorialUI(
  c: Client,
  comprasPorCliente?: ReadonlyMap<string, number>
): number {
  if (comprasPorCliente?.has(c.id)) {
    return comprasPorCliente.get(c.id) ?? 0;
  }
  const v = c.ventasHistorial;
  if (v != null && Number.isFinite(v)) return Math.max(0, Math.floor(Number(v)));
  return c.ticketsComprados ?? 0;
}
