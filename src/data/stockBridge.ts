import { updateStockDexie } from '@/db/dexieStock';
import { adjustStockFirestore } from '@/lib/firestore/productsFirestore';
import type { StockEntradaMeta } from '@/types';

/**
 * Descuenta o ajusta stock: Firestore si hay sucursal, si no Dexie.
 * En **entrada**, `entradaMeta` puede incluir proveedor y precio unitario de compra para el historial.
 */
export async function updateStockUnified(
  sucursalId: string | undefined,
  productId: string,
  cantidad: number,
  tipo: 'entrada' | 'salida' | 'ajuste',
  motivo?: string,
  referencia?: string,
  usuarioId?: string,
  entradaMeta?: StockEntradaMeta
): Promise<void> {
  if (sucursalId) {
    await adjustStockFirestore(
      sucursalId,
      productId,
      cantidad,
      tipo,
      motivo,
      referencia,
      usuarioId,
      entradaMeta
    );
    return;
  }
  await updateStockDexie(productId, cantidad, tipo, motivo, referencia, usuarioId, entradaMeta);
}
