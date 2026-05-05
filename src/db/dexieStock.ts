import { db } from './database';
import type { StockEntradaMeta } from '@/types';
import { productEsServicio } from '@/lib/productServicio';

/**
 * Ajuste de existencias solo en Dexie (modo sin sucursal / local).
 */
export async function updateStockDexie(
  productId: string,
  cantidad: number,
  tipo: 'entrada' | 'salida' | 'ajuste',
  motivo?: string,
  referencia?: string,
  usuarioId?: string,
  entradaMeta?: StockEntradaMeta
): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) throw new Error('Producto no encontrado');
  if (productEsServicio(product)) return;

  const cantidadAnterior = product.existencia;
  let cantidadNueva: number;

  if (tipo === 'entrada') {
    cantidadNueva = cantidadAnterior + cantidad;
  } else if (tipo === 'salida') {
    cantidadNueva = cantidadAnterior - cantidad;
  } else {
    cantidadNueva = cantidad;
  }

  await db.products.update(productId, {
    existencia: cantidadNueva,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  const prov = entradaMeta?.proveedor?.trim();
  const provCod = entradaMeta?.proveedorCodigo?.trim();
  const pu = entradaMeta?.precioUnitarioCompra;
  await db.inventoryMovements.add({
    id: crypto.randomUUID(),
    productId,
    tipo,
    cantidad,
    cantidadAnterior,
    cantidadNueva,
    motivo,
    referencia,
    proveedor: tipo === 'entrada' && prov ? prov : undefined,
    proveedorCodigo:
      tipo === 'entrada' && provCod && provCod.length > 0 ? provCod : undefined,
    precioUnitarioCompra:
      tipo === 'entrada' && pu != null && Number.isFinite(pu) && pu >= 0 ? pu : undefined,
    usuarioId: usuarioId || 'system',
    createdAt: new Date(),
    syncStatus: 'pending',
  });
}
