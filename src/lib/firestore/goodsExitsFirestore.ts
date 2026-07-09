import type { GoodsExit, GoodsExitItem } from '@/types';
import {
  parseGoodsExitEstado,
  parseGoodsExitMotivo,
} from '@/lib/goodsExitLogic';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function mapGoodsExitItem(raw: unknown): GoodsExitItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const productId = String(o.productId ?? '').trim();
  if (!productId) return null;
  return {
    lineId: String(o.lineId ?? crypto.randomUUID()),
    productId,
    nombre: typeof o.nombre === 'string' ? o.nombre : undefined,
    sku: typeof o.sku === 'string' ? o.sku : undefined,
    cantidad: Math.max(0, Math.floor(Number(o.cantidad) || 0)),
  };
}

function mapGoodsExit(sucursalId: string, id: string, doc: Record<string, unknown>): GoodsExit {
  const productos = (Array.isArray(doc.productos) ? doc.productos : [])
    .map(mapGoodsExitItem)
    .filter((x): x is GoodsExitItem => x != null);
  return {
    id,
    folio: String(doc.folio ?? ''),
    motivo: parseGoodsExitMotivo(doc.motivo),
    motivoDetalle: typeof doc.motivoDetalle === 'string' ? doc.motivoDetalle : undefined,
    destino: typeof doc.destino === 'string' ? doc.destino : undefined,
    productos,
    estado: parseGoodsExitEstado(doc.estado),
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

let lastGoodsExits: GoodsExit[] = [];
const goodsExitsListeners = new Set<(rows: GoodsExit[]) => void>();
let goodsExitsChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let goodsExitsSucursalId: string | null = null;
let goodsExitsReloadDebounced: (() => void) | null = null;

export function getGoodsExitsCatalogSnapshot(): GoodsExit[] {
  return lastGoodsExits;
}

export async function generateGoodsExitFolioFirestore(sucursalId: string): Promise<string> {
  const supabase = getSupabase();
  const now = new Date();
  const prefix = `SAL-${yyyymmdd(now)}`;
  const { data, error } = await supabase.from('goods_exits').select('doc').eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);
  const count = (data ?? []).filter((r) =>
    String((r.doc as Record<string, unknown>)?.folio ?? '').startsWith(prefix)
  ).length;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

export async function createGoodsExitFirestore(
  sucursalId: string,
  exit: Omit<GoodsExit, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'> & { folio?: string }
): Promise<GoodsExit> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const folio = exit.folio?.trim() || (await generateGoodsExitFolioFirestore(sucursalId));
  const doc: Record<string, unknown> = {
    ...exit,
    folio,
    sucursalId,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('goods_exits').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  const row = mapGoodsExit(sucursalId, id, doc);
  lastGoodsExits = [row, ...lastGoodsExits.filter((x) => x.id !== id)].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  goodsExitsListeners.forEach((l) => {
    try {
      l([...lastGoodsExits]);
    } catch (e) {
      console.error('createGoodsExitFirestore listener:', e);
    }
  });
  return row;
}

export function subscribeGoodsExitsCatalog(
  sucursalId: string,
  onData: (rows: GoodsExit[]) => void
): () => void {
  onData([...lastGoodsExits]);
  goodsExitsListeners.add(onData);

  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase
      .from('goods_exits')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Goods exits:', error);
      if (lastGoodsExits.length > 0) {
        goodsExitsListeners.forEach((l) => {
          try {
            l([...lastGoodsExits]);
          } catch (e) {
            console.error('subscribeGoodsExitsCatalog listener:', e);
          }
        });
      }
      return;
    }
    lastGoodsExits = (data ?? [])
      .map((r) => mapGoodsExit(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    goodsExitsListeners.forEach((l) => {
      try {
        l([...lastGoodsExits]);
      } catch (e) {
        console.error('subscribeGoodsExitsCatalog listener:', e);
      }
    });
  };

  if (goodsExitsSucursalId !== sucursalId) {
    if (goodsExitsChannel) {
      void supabase.removeChannel(goodsExitsChannel);
      goodsExitsChannel = null;
    }
    goodsExitsSucursalId = sucursalId;
    goodsExitsReloadDebounced = createDebouncedAsyncFn(load, 500);
    lastGoodsExits = [];
    void load();
    goodsExitsChannel = supabase
      .channel(`goods_exits-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'goods_exits', filter: `sucursal_id=eq.${sucursalId}` },
        () => {
          goodsExitsReloadDebounced?.();
        }
      )
      .subscribe();
  } else {
    try {
      onData([...lastGoodsExits]);
    } catch (e) {
      console.error('subscribeGoodsExitsCatalog (resync existing):', e);
    }
  }

  return () => {
    goodsExitsListeners.delete(onData);
  };
}
