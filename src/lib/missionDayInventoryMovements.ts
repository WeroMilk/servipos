import { getInventoryMovementsList } from '@/db/database';
import { fetchRecentInventoryMovementsOnce } from '@/lib/firestore/inventoryMovementsFirestore';
import { tipoMovimientoLabel } from '@/lib/inventoryMovementLabels';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { getMexicoDateKey } from '@/lib/quincenaMx';
import type { InventoryMovement, Product } from '@/types';

const FETCH_LIMIT = 500;

export async function fetchInventoryMovementsForUserMexicoDay(
  sucursalId: string | undefined,
  userId: string,
  dateKey: string
): Promise<InventoryMovement[]> {
  const sid = sucursalId?.trim();
  const rows = sid
    ? await fetchRecentInventoryMovementsOnce(sid, FETCH_LIMIT)
    : await getInventoryMovementsList(FETCH_LIMIT);
  return filterMovementsByUserMexicoDay(rows, userId, dateKey);
}

export function filterMovementsByUserMexicoDay(
  rows: InventoryMovement[],
  userId: string,
  dateKey: string
): InventoryMovement[] {
  const uid = userId.trim();
  if (!uid) return [];
  return rows
    .filter((m) => {
      if (m.usuarioId !== uid) return false;
      const d = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt as unknown as string);
      return getMexicoDateKey(d) === dateKey;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Líneas listas para ticket térmico (orden cronológico ascendente). */
export function buildMissionDayTicketLines(
  movs: InventoryMovement[],
  productById: Map<string, Pick<Product, 'nombre' | 'sku'>>
): { tipoLabel: string; linea1: string; linea2: string }[] {
  return movs.map((m) => {
    const tipoLabel = tipoMovimientoLabel(m.tipo);
    const prod = productById.get(m.productId);
    const nombre =
      (m.nombreRegistro && m.nombreRegistro.trim()) || prod?.nombre?.trim() || m.productId;
    const sku = (m.skuRegistro && m.skuRegistro.trim()) || prod?.sku?.trim() || '—';
    const hora = formatInAppTimezone(m.createdAt, { hour: '2-digit', minute: '2-digit' });
    const esCatalogo =
      m.tipo === 'producto_alta' || m.tipo === 'producto_baja' || m.tipo === 'producto_edicion';
    const qtyPart = esCatalogo ? '' : `${Math.abs(Number(m.cantidad) || 0)} u`;
    const motivo = (m.motivo && m.motivo.trim()) ? m.motivo.trim().slice(0, 56) : '';
    const linea2 = [sku, qtyPart, motivo, hora].filter(Boolean).join(' · ');
    return { tipoLabel, linea1: nombre, linea2 };
  });
}
