import { getSupabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CartDraftSnapshot } from '@/stores/cartStore';

type PosCartDraftDoc = {
  cart: CartDraftSnapshot;
  updatedAtMs: number;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null;
}

function parseDraftDoc(raw: unknown): PosCartDraftDoc | null {
  if (!isObject(raw)) return null;
  const cart = raw.cart;
  const updatedAtMs = Number(raw.updatedAtMs);
  if (!isObject(cart) || !Number.isFinite(updatedAtMs)) return null;
  return {
    cart: cart as CartDraftSnapshot,
    updatedAtMs,
  };
}

export async function getPosCartDraftOnce(
  sucursalId: string,
  userId: string
): Promise<PosCartDraftDoc | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pos_carts')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.doc) return null;
  return parseDraftDoc(data.doc);
}

export async function savePosCartDraft(
  sucursalId: string,
  userId: string,
  cart: CartDraftSnapshot
): Promise<number> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const updatedAtMs = Date.now();
  const doc: PosCartDraftDoc = {
    cart,
    updatedAtMs,
  };
  const { error } = await supabase.from('pos_carts').upsert(
    {
      sucursal_id: sucursalId,
      user_id: userId,
      doc,
      updated_at: nowIso,
    },
    { onConflict: 'sucursal_id,user_id' }
  );
  if (error) throw new Error(error.message);
  return updatedAtMs;
}

/** Solo Realtime: la carga inicial la hace el hook para evitar carreras con otra petición en paralelo. */
export function subscribePosCartDraft(
  sucursalId: string,
  userId: string,
  onData: (doc: PosCartDraftDoc | null) => void
): () => void {
  const supabase = getSupabase();
  let channel: RealtimeChannel | null = supabase
    .channel(`pos-cart-${sucursalId}-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pos_carts',
        filter: `sucursal_id=eq.${sucursalId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as
          | { user_id?: string; doc?: unknown }
          | null;
        if (!row || String(row.user_id ?? '') !== userId) return;
        onData(parseDraftDoc(row.doc) ?? null);
      }
    )
    .subscribe();
  return () => {
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };
}
