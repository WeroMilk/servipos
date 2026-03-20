import { db } from './database';

/**
 * Ajuste de existencias solo en Dexie (modo sin sucursal / local).
 */
export async function updateStockDexie(
  productId: string,
  cantidad: number,
  tipo: 'entrada' | 'salida' | 'ajuste',
  motivo?: string,
  referencia?: string,
  usuarioId?: string
): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) throw new Error('Producto no encontrado');

  const cantidadAnterior = product.existencia;
  let cantidadNueva: number;

  if (tipo === 'entrada') {
    cantidadNueva = cantidadAnterior + cantidad;
  } else if (tipo === 'salida') {
    cantidadNueva = cantidadAnterior - cantidad;
    if (cantidadNueva < 0) throw new Error('Stock insuficiente');
  } else {
    cantidadNueva = cantidad;
  }

  await db.products.update(productId, {
    existencia: cantidadNueva,
    updatedAt: new Date(),
    syncStatus: 'pending',
  });

  await db.inventoryMovements.add({
    id: crypto.randomUUID(),
    productId,
    tipo,
    cantidad,
    cantidadAnterior,
    cantidadNueva,
    motivo,
    referencia,
    usuarioId: usuarioId || 'system',
    createdAt: new Date(),
    syncStatus: 'pending',
  });
}
