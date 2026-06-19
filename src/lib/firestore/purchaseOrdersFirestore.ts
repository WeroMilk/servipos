import type { PurchaseOrder, PurchaseOrderItem } from '@/types';
import { derivePurchaseOrderEstado, mapLegacyPurchaseOrderEstado } from '@/lib/purchaseOrderLogic';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function mapPurchaseOrderItem(raw: unknown): PurchaseOrderItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const productId = String(o.productId ?? '').trim();
  if (!productId) return null;
  const legacySolicitada = Number(o.cantidadSolicitada);
  const facturada = Number(o.cantidadFacturada ?? legacySolicitada);
  return {
    lineId: String(o.lineId ?? crypto.randomUUID()),
    productId,
    nombre: typeof o.nombre === 'string' ? o.nombre : undefined,
    sku: typeof o.sku === 'string' ? o.sku : undefined,
    codigoProveedor:
      typeof o.codigoProveedor === 'string' && o.codigoProveedor.trim()
        ? o.codigoProveedor.trim()
        : undefined,
    cantidadFacturada: Math.max(0, Number.isFinite(facturada) ? facturada : 0),
    cantidadRecibida: Math.max(0, Number(o.cantidadRecibida) || 0),
    precioUnitarioCompra:
      o.precioUnitarioCompra != null && Number.isFinite(Number(o.precioUnitarioCompra))
        ? Number(o.precioUnitarioCompra)
        : undefined,
    actualizarPrecioCompra: o.actualizarPrecioCompra !== false,
  };
}

function mapPurchaseOrder(sucursalId: string, id: string, doc: Record<string, unknown>): PurchaseOrder {
  const productos = (Array.isArray(doc.productos) ? doc.productos : [])
    .map(mapPurchaseOrderItem)
    .filter((x): x is PurchaseOrderItem => x != null);
  const estadoRaw = mapLegacyPurchaseOrderEstado(doc.estado);
  const estado =
    estadoRaw === 'cancelada' ? 'cancelada' : derivePurchaseOrderEstado(productos);
  return {
    id,
    folio: String(doc.folio ?? ''),
    numeroFactura: typeof doc.numeroFactura === 'string' ? doc.numeroFactura : undefined,
    proveedor: String(doc.proveedor ?? '').trim(),
    proveedorCodigo: typeof doc.proveedorCodigo === 'string' ? doc.proveedorCodigo : undefined,
    productos,
    estado,
    notas: typeof doc.notas === 'string' ? doc.notas : undefined,
    sucursalId,
    usuarioId: typeof doc.usuarioId === 'string' ? doc.usuarioId : undefined,
    usuarioNombre: typeof doc.usuarioNombre === 'string' ? doc.usuarioNombre : undefined,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
    syncStatus: 'synced',
  };
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function generatePurchaseOrderFolioFirestore(sucursalId: string): Promise<string> {
  const supabase = getSupabase();
  const now = new Date();
  const prefix = `PED-${yyyymmdd(now)}`;
  const { data, error } = await supabase.from('purchase_orders').select('doc').eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);
  const count = (data ?? []).filter((r) =>
    String((r.doc as Record<string, unknown>)?.folio ?? '').startsWith(prefix)
  ).length;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

export async function createPurchaseOrderFirestore(
  sucursalId: string,
  order: Omit<PurchaseOrder, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>
): Promise<PurchaseOrder> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const folio = await generatePurchaseOrderFolioFirestore(sucursalId);
  const doc: Record<string, unknown> = {
    ...order,
    folio,
    sucursalId,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('purchase_orders').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return mapPurchaseOrder(sucursalId, id, doc);
}

export async function updatePurchaseOrderFirestore(
  sucursalId: string,
  orderId: string,
  updates: Partial<PurchaseOrder>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('purchase_orders')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', orderId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Pedido no encontrado');
  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>) };
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) {
      Reflect.deleteProperty(doc, k);
    } else {
      doc[k] = v as unknown;
    }
  }
  doc.updatedAt = now;
  const { error } = await supabase
    .from('purchase_orders')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', orderId);
  if (error) throw new Error(error.message);
}

export async function deletePurchaseOrderFirestore(sucursalId: string, orderId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('purchase_orders')
    .delete()
    .eq('sucursal_id', sucursalId)
    .eq('id', orderId);
  if (error) throw new Error(error.message);
}

export function subscribePurchaseOrdersCatalog(
  sucursalId: string,
  onData: (rows: PurchaseOrder[]) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Purchase orders:', error);
      onData([]);
      return;
    }
    const list = (data ?? [])
      .map((r) => mapPurchaseOrder(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    onData(list);
  };
  void load();
  const ch = supabase
    .channel(`purchase_orders-${sucursalId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'purchase_orders',
        filter: `sucursal_id=eq.${sucursalId}`,
      },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
