import type { IncomingStoreTransfer, StoreTransferLine } from '@/types';
import {
  ensureProductAtDestForTransfer,
  resolveDestProductIdForTransfer,
} from '@/lib/firestore/productsFirestore';
import { getSupabase } from '@/lib/supabaseClient';

function firestoreTimestampToDate(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

function mapItems(raw: unknown): StoreTransferLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const o = x as Record<string, unknown>;
    return {
      productIdOrigen: String(o.productIdOrigen ?? ''),
      sku: String(o.sku ?? ''),
      codigoBarras: typeof o.codigoBarras === 'string' ? o.codigoBarras : undefined,
      nombre: String(o.nombre ?? ''),
      cantidad: Number(o.cantidad) || 0,
    };
  });
}

function docToIncoming(id: string, d: Record<string, unknown>): IncomingStoreTransfer {
  return {
    id,
    estado: d.estado === 'recibida' ? 'recibida' : 'pendiente',
    origenSucursalId: String(d.origenSucursalId ?? ''),
    origenSaleId: String(d.origenSaleId ?? ''),
    origenFolio: String(d.origenFolio ?? ''),
    items: mapItems(d.items),
    usuarioNombre:
      typeof d.usuarioNombre === 'string' && d.usuarioNombre.trim().length > 0
        ? d.usuarioNombre.trim()
        : undefined,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    recibidaAt: d.recibidaAt != null ? firestoreTimestampToDate(d.recibidaAt) : undefined,
    recibidaPorUserId: d.recibidaPorUserId != null ? String(d.recibidaPorUserId) : undefined,
    recibidaPorNombre:
      typeof d.recibidaPorNombre === 'string' && d.recibidaPorNombre.trim().length > 0
        ? d.recibidaPorNombre.trim()
        : undefined,
  };
}

export function subscribePendingIncomingTransfers(
  sucursalId: string,
  onData: (rows: IncomingStoreTransfer[]) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data: rows, error } = await supabase
      .from('incoming_transfers')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      onData([]);
      return;
    }
    const list = (rows ?? [])
      .filter((r) => String((r.doc as { estado?: string })?.estado ?? '') === 'pendiente')
      .map((r) => docToIncoming(r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    onData(list);
  };
  void load();
  const ch = supabase
    .channel(`inc-trans-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'incoming_transfers', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export function subscribeOutgoingPendingTransferIds(
  sucursalId: string,
  onIds: (ids: Set<string>) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data: rows, error } = await supabase
      .from('outgoing_transfers')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      onIds(new Set());
      return;
    }
    const ids = new Set(
      (rows ?? [])
        .filter((r) => String((r.doc as { estado?: string })?.estado ?? '') === 'pendiente')
        .map((r) => r.id)
    );
    onIds(ids);
  };
  void load();
  const ch = supabase
    .channel(`out-trans-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'outgoing_transfers', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function confirmIncomingStoreTransfer(
  destSucursalId: string,
  transferId: string,
  usuarioId: string,
  usuarioNombre: string
): Promise<void> {
  const supabase = getSupabase();
  const { data: incRow } = await supabase
    .from('incoming_transfers')
    .select('doc')
    .eq('sucursal_id', destSucursalId)
    .eq('id', transferId)
    .maybeSingle();
  if (!incRow?.doc) throw new Error('Traspaso no encontrado');
  const data = incRow.doc as Record<string, unknown>;
  if (data.estado !== 'pendiente') throw new Error('Este traspaso ya fue confirmado');

  const items = mapItems(data.items);
  const origenSucursalId = String(data.origenSucursalId ?? '');
  if (!origenSucursalId) throw new Error('Datos de traspaso incompletos');

  const resolved: { destProductId: string; cantidad: number; nombre: string }[] = [];
  for (const line of items) {
    if (line.cantidad <= 0) continue;
    let pid = await resolveDestProductIdForTransfer(
      destSucursalId,
      line.productIdOrigen,
      line.sku,
      line.codigoBarras
    );
    if (!pid) {
      pid = await ensureProductAtDestForTransfer(destSucursalId, origenSucursalId, line.productIdOrigen, {
        nombre: line.nombre,
        sku: line.sku,
        codigoBarras: line.codigoBarras,
      });
    }
    resolved.push({ destProductId: pid, cantidad: line.cantidad, nombre: line.nombre });
  }

  const lines = resolved.map((r) => ({
    destProductId: r.destProductId,
    cantidad: r.cantidad,
    nombre: r.nombre,
  }));

  const { error } = await supabase.rpc('rpc_confirm_incoming_transfer', {
    p_dest_sucursal_id: destSucursalId,
    p_transfer_id: transferId,
    p_usuario_id: usuarioId,
    p_usuario_nombre: usuarioNombre,
    p_lines: lines,
  });
  if (error) throw new Error(error.message);
}
