import { updateStockDexie } from '@/db/dexieStock';
import { adjustStockFirestore } from '@/lib/firestore/productsFirestore';

/**
 * Descuenta o ajusta stock: Firestore si hay sucursal, si no Dexie.
 */
export async function updateStockUnified(
  sucursalId: string | undefined,
  productId: string,
  cantidad: number,
  tipo: 'entrada' | 'salida' | 'ajuste',
  motivo?: string,
  referencia?: string,
  usuarioId?: string
): Promise<void> {
  if (sucursalId) {
    await adjustStockFirestore(
      sucursalId,
      productId,
      cantidad,
      tipo,
      motivo,
      referencia,
      usuarioId
    );
    return;
  }
  await updateStockDexie(productId, cantidad, tipo, motivo, referencia, usuarioId);
}
