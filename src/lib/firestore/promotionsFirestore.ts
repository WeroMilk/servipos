import type { PromoKind, Promotion } from '@/types';
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

function parseKind(v: unknown): PromoKind {
  if (v === 'nxm' || v === 'nth_half' || v === 'percent') return v;
  return 'percent';
}

function mapPromotion(sucursalId: string, id: string, doc: Record<string, unknown>): Promotion {
  return {
    id,
    nombre: String(doc.nombre ?? ''),
    kind: parseKind(doc.kind),
    percent: doc.percent != null ? Number(doc.percent) : undefined,
    buyQty: doc.buyQty != null ? Number(doc.buyQty) : undefined,
    payQty: doc.payQty != null ? Number(doc.payQty) : undefined,
    everyNth: doc.everyNth != null ? Number(doc.everyNth) : undefined,
    fechaInicio: String(doc.fechaInicio ?? ''),
    fechaFin: String(doc.fechaFin ?? ''),
    productIds: Array.isArray(doc.productIds)
      ? doc.productIds.map((x) => String(x)).filter(Boolean)
      : [],
    activa: doc.activa !== false,
    sucursalId,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
  };
}

export type PromotionInput = Omit<Promotion, 'id' | 'createdAt' | 'updatedAt' | 'sucursalId'>;

/**
 * Un producto no puede pertenecer a dos promociones de la misma sucursal.
 * @returns nombres de promos conflictivas por productId
 */
export function findProductPromoConflicts(
  all: Promotion[],
  productIds: string[],
  excludePromoId?: string
): { productId: string; promoNombre: string }[] {
  const want = new Set(productIds);
  const out: { productId: string; promoNombre: string }[] = [];
  for (const p of all) {
    if (excludePromoId && p.id === excludePromoId) continue;
    for (const pid of p.productIds) {
      if (want.has(pid)) {
        out.push({ productId: pid, promoNombre: p.nombre || p.id });
      }
    }
  }
  return out;
}

function conflictError(conflicts: { productId: string; promoNombre: string }[]): Error {
  const sample = conflicts
    .slice(0, 3)
    .map((c) => `${c.productId} (${c.promoNombre})`)
    .join(', ');
  return new Error(
    `Un producto no puede estar en dos promociones. Conflictos: ${sample}${
      conflicts.length > 3 ? '…' : ''
    }`
  );
}

async function listPromotionsForSucursal(sucursalId: string): Promise<Promotion[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('promotions')
    .select('id, doc')
    .eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapPromotion(sucursalId, r.id, r.doc as Record<string, unknown>));
}

export async function createPromotionFirestore(
  sucursalId: string,
  input: PromotionInput
): Promise<string> {
  const all = await listPromotionsForSucursal(sucursalId);
  const conflicts = findProductPromoConflicts(all, input.productIds);
  if (conflicts.length > 0) throw conflictError(conflicts);

  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc: Record<string, unknown> = { ...input, createdAt: now, updatedAt: now };
  const { error } = await supabase.from('promotions').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updatePromotionFirestore(
  sucursalId: string,
  promoId: string,
  updates: Partial<PromotionInput>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('promotions')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', promoId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Promoción no encontrada');

  const mergedProductIds =
    updates.productIds ??
    (Array.isArray((row.doc as Record<string, unknown>).productIds)
      ? ((row.doc as Record<string, unknown>).productIds as unknown[]).map(String)
      : []);

  const all = await listPromotionsForSucursal(sucursalId);
  const conflicts = findProductPromoConflicts(all, mergedProductIds, promoId);
  if (conflicts.length > 0) throw conflictError(conflicts);

  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>), ...updates, updatedAt: now };
  const { error } = await supabase
    .from('promotions')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', promoId);
  if (error) throw new Error(error.message);
}

export async function deletePromotionFirestore(sucursalId: string, promoId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('promotions')
    .delete()
    .eq('sucursal_id', sucursalId)
    .eq('id', promoId);
  if (error) throw new Error(error.message);
}

let lastPromotions: Promotion[] = [];
const listeners = new Set<(rows: Promotion[]) => void>();
let channel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let sid: string | null = null;
let reloadDebounced: (() => void) | null = null;

export function getPromotionsCatalogSnapshot(): Promotion[] {
  return lastPromotions;
}

export function subscribePromotionsCatalog(
  sucursalId: string,
  onData: (rows: Promotion[]) => void
): () => void {
  onData([...lastPromotions]);
  listeners.add(onData);
  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase
      .from('promotions')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Promotions:', error);
      return;
    }
    lastPromotions = (data ?? [])
      .map((r) => mapPromotion(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    listeners.forEach((l) => {
      try {
        l([...lastPromotions]);
      } catch (e) {
        console.error(e);
      }
    });
  };

  if (sid !== sucursalId) {
    if (channel) void supabase.removeChannel(channel);
    sid = sucursalId;
    reloadDebounced = createDebouncedAsyncFn(load, 500);
    lastPromotions = [];
    void load();
    channel = supabase
      .channel(`promotions-${sucursalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'promotions',
          filter: `sucursal_id=eq.${sucursalId}`,
        },
        () => reloadDebounced?.()
      )
      .subscribe();
  } else {
    onData([...lastPromotions]);
  }

  return () => {
    listeners.delete(onData);
  };
}
