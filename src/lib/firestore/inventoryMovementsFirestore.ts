import type { InventoryMovement } from '@/types';
import { getSupabase } from '@/lib/supabaseClient';

const DEFAULT_LIMIT = 500;

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

const TIPOS: InventoryMovement['tipo'][] = [
  'entrada',
  'salida',
  'ajuste',
  'venta',
  'compra',
  'producto_alta',
  'producto_baja',
  'producto_edicion',
];

function parseTipo(raw: unknown): InventoryMovement['tipo'] {
  const s = String(raw ?? '');
  return TIPOS.includes(s as InventoryMovement['tipo']) ? (s as InventoryMovement['tipo']) : 'ajuste';
}

export function movementDocToMovement(id: string, d: Record<string, unknown>): InventoryMovement {
  const pu = d.precioUnitarioCompra;
  const precioUnitarioCompra =
    typeof pu === 'number' && Number.isFinite(pu) && pu >= 0 ? pu : undefined;
  const prov = d.proveedor != null ? String(d.proveedor).trim() : '';
  const provCodRaw = d.proveedorCodigo != null ? String(d.proveedorCodigo).trim() : '';
  const nr = d.nombreRegistro != null ? String(d.nombreRegistro).trim() : '';
  const sr = d.skuRegistro != null ? String(d.skuRegistro).trim() : '';
  return {
    id,
    productId: String(d.productId ?? ''),
    tipo: parseTipo(d.tipo),
    cantidad: Number(d.cantidad) || 0,
    cantidadAnterior: Number(d.cantidadAnterior) || 0,
    cantidadNueva: Number(d.cantidadNueva) || 0,
    motivo: d.motivo != null && String(d.motivo).length > 0 ? String(d.motivo) : undefined,
    referencia: d.referencia != null && String(d.referencia).length > 0 ? String(d.referencia) : undefined,
    proveedor: prov.length > 0 ? prov : undefined,
    proveedorCodigo: provCodRaw.length > 0 ? provCodRaw : undefined,
    precioUnitarioCompra,
    nombreRegistro: nr.length > 0 ? nr : undefined,
    skuRegistro: sr.length > 0 ? sr : undefined,
    usuarioId: String(d.usuarioId ?? ''),
    createdAt: firestoreTimestampToDate(d.createdAt),
    syncStatus: 'synced',
  };
}

export type CatalogInventoryMovementInput = {
  productId: string;
  tipo: 'producto_alta' | 'producto_baja' | 'producto_edicion';
  motivo: string;
  usuarioId: string;
  nombreRegistro?: string;
  skuRegistro?: string;
};

export async function appendCatalogInventoryMovementFirestore(
  sucursalId: string,
  input: CatalogInventoryMovementInput
): Promise<void> {
  const supabase = getSupabase();
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const doc = {
    productId: input.productId,
    tipo: input.tipo,
    cantidad: 0,
    cantidadAnterior: 0,
    cantidadNueva: 0,
    motivo: input.motivo,
    referencia: null,
    proveedor: null,
    precioUnitarioCompra: null,
    nombreRegistro: input.nombreRegistro?.trim() || null,
    skuRegistro: input.skuRegistro?.trim() || null,
    usuarioId: input.usuarioId,
    createdAt: now,
  };
  const { error } = await supabase.from('inventory_movements').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    created_at: now,
  });
  if (error) throw new Error(error.message);
}

const BY_PRODUCT_LIMIT = 200;

export async function fetchInventoryMovementsByProductIdFirestore(
  sucursalId: string,
  productId: string,
  maxDocs = BY_PRODUCT_LIMIT
): Promise<InventoryMovement[]> {
  const pid = productId.trim();
  if (!pid) return [];
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from('inventory_movements')
    .select('id, doc')
    .eq('sucursal_id', sucursalId)
    .limit(maxDocs * 2);
  const list = (rows ?? [])
    .filter((r) => String((r.doc as { productId?: string })?.productId ?? '') === pid)
    .map((r) => movementDocToMovement(r.id, r.doc as Record<string, unknown>))
    .slice(0, maxDocs);
  list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list;
}

export async function fetchRecentInventoryMovementsOnce(
  sucursalId: string,
  maxDocs = DEFAULT_LIMIT
): Promise<InventoryMovement[]> {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from('inventory_movements')
    .select('id, doc, created_at')
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(maxDocs);
  return (rows ?? []).map((r) =>
    movementDocToMovement(r.id, r.doc as Record<string, unknown>)
  );
}

export function subscribeInventoryMovements(
  sucursalId: string,
  onUpdate: (movements: InventoryMovement[]) => void,
  maxDocs = DEFAULT_LIMIT
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data: rows, error } = await supabase
      .from('inventory_movements')
      .select('id, doc, created_at')
      .eq('sucursal_id', sucursalId)
      .order('created_at', { ascending: false })
      .limit(maxDocs);
    if (error) {
      console.error('inventoryMovements:', error);
      onUpdate([]);
      return;
    }
    onUpdate(
      (rows ?? []).map((r) => movementDocToMovement(r.id, r.doc as Record<string, unknown>))
    );
  };
  void load();
  const ch = supabase
    .channel(`inv-mov-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_movements', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function deleteAllInventoryMovementsFirestore(sucursalId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('inventory_movements').delete().eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);
}
