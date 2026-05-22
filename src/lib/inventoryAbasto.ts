import type { InventoryMovement, Product } from '@/types';
import { normSkuBarcode } from '@/lib/productCatalogUniqueness';

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

export function isMovimientoCatalogoInventario(tipo: InventoryMovement['tipo']): boolean {
  return tipo === 'producto_alta' || tipo === 'producto_baja' || tipo === 'producto_edicion';
}

/** Llegadas de mercancía o auditoría de catálogo (altas, bajas, ediciones con detalle en motivo). */
export function isMovimientoHistorialAbasto(m: InventoryMovement): boolean {
  if (isMovimientoLlegadaMercancia(m)) return true;
  return isMovimientoCatalogoInventario(m.tipo);
}

export function matchesAbastoHistorialSearch(
  m: InventoryMovement,
  product: Product | undefined,
  rawQuery: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const normQ = normSkuBarcode(rawQuery);
  if (m.motivo?.toLowerCase().includes(q)) return true;
  if (m.proveedor?.toLowerCase().includes(q)) return true;
  if (m.proveedorCodigo?.toLowerCase().includes(q)) return true;
  if (m.nombreRegistro?.toLowerCase().includes(q)) return true;
  if (m.skuRegistro?.toLowerCase().includes(q)) return true;
  if (product) {
    if ((product.nombre ?? '').toLowerCase().includes(q)) return true;
    if ((product.sku ?? '').toLowerCase().includes(q)) return true;
    if ((product.codigoBarras ?? '').toLowerCase().includes(q)) return true;
    if ((product.proveedor ?? '').toLowerCase().includes(q)) return true;
    if (normQ.length > 0) {
      if (normSkuBarcode(String(product.sku ?? '')).includes(normQ)) return true;
      if (normSkuBarcode(String(product.codigoBarras ?? '')).includes(normQ)) return true;
    }
  }
  return false;
}
