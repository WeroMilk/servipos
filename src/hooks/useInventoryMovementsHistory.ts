import { useCallback, useEffect, useState } from 'react';
import { getInventoryMovementsList } from '@/db/database';
import { subscribeInventoryMovements } from '@/lib/firestore/inventoryMovementsFirestore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import type { InventoryMovement } from '@/types';

const LIMIT = 500;

/**
 * Historial de movimientos de inventario (Firestore en sucursal, Dexie en local).
 * `enabled` evita suscripción/carga hasta que el usuario abre el panel (p. ej. diálogo).
 * `limit`: número máximo; `null` = sin límite (todos los movimientos).
 */
export function useInventoryMovementsHistory(enabled: boolean, limit: number | null = LIMIT) {
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshLocal = useCallback(async () => {
    const rows = await getInventoryMovementsList(limit);
    setMovements(rows);
  }, [limit]);

  useEffect(() => {
    if (!enabled) return;

    if (effectiveSucursalId) {
      setLoading(true);
      const unsub = subscribeInventoryMovements(effectiveSucursalId, (rows) => {
        setMovements(rows);
        setLoading(false);
      }, limit);
      return unsub;
    }

    let cancelled = false;
    setLoading(true);
    getInventoryMovementsList(limit)
      .then((rows) => {
        if (!cancelled) {
          setMovements(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMovements([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, effectiveSucursalId, limit]);

  return { movements, loading, refreshLocal };
}
