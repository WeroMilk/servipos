import type { InventoryMovement } from '@/types';

/**
 * Entrada que cuenta como llegada de mercancía: aumento de stock vía entrada/compra
 * y con al menos proveedor o precio unitario de compra capturado en el movimiento.
 * Excluye ajustes de entrada sin esos datos (p. ej. correcciones de inventario).
 */
export function isMovimientoLlegadaMercancia(m: InventoryMovement): boolean {
  if ((m.tipo !== 'entrada' && m.tipo !== 'compra') || m.cantidad <= 0) return false;
  const prov = m.proveedor?.trim() ?? '';
  const pu = m.precioUnitarioCompra;
  const hasPrecio = pu != null && Number.isFinite(pu);
  return prov.length > 0 || hasPrecio;
}
