import { appendCatalogInventoryMovementLocal } from '@/db/database';
import {
  appendCatalogInventoryMovementFirestore,
  type CatalogInventoryMovementInput,
} from '@/lib/firestore/inventoryMovementsFirestore';

/**
 * Registra en la misma colección/tab de movimientos un evento de catálogo (alta/baja/edición).
 */
export async function appendCatalogInventoryMovement(
  sucursalId: string | null | undefined,
  input: CatalogInventoryMovementInput
): Promise<void> {
  const sid = sucursalId != null && String(sucursalId).trim().length > 0 ? String(sucursalId).trim() : null;
  if (sid) {
    await appendCatalogInventoryMovementFirestore(sid, input);
    return;
  }
  await appendCatalogInventoryMovementLocal(input);
}
