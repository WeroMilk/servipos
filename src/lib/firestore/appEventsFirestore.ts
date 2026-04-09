import type { AppEventKind, AppEventLogRecord } from '@/types';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (
    v &&
    typeof v === 'object' &&
    'toDate' in v &&
    typeof (v as { toDate: () => Date }).toDate === 'function'
  ) {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date();
}

function parseKind(v: unknown): AppEventKind {
  if (v === 'success' || v === 'warning' || v === 'error' || v === 'info') return v;
  return 'info';
}

export function docToAppEvent(id: string, d: Record<string, unknown>): AppEventLogRecord {
  const meta = d.meta;
  return {
    id,
    createdAt: tsToDate(d.createdAt),
    kind: parseKind(d.kind),
    source: String(d.source ?? 'app'),
    title: String(d.title ?? ''),
    detail: d.detail != null ? String(d.detail) : undefined,
    actorUserId: typeof d.actorUserId === 'string' ? d.actorUserId : null,
    actorName: String(d.actorName ?? ''),
    actorEmail: String(d.actorEmail ?? ''),
    actorRole: String(d.actorRole ?? ''),
    sucursalId: typeof d.sucursalId === 'string' ? d.sucursalId : undefined,
    route: typeof d.route === 'string' ? d.route : undefined,
    meta:
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : undefined,
  };
}

export type AppendAppEventInput = {
  kind: AppEventKind;
  source: string;
  title: string;
  detail?: string;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  sucursalId?: string;
  route?: string;
  meta?: Record<string, unknown>;
};

export async function appendAppEventRecord(input: AppendAppEventInput): Promise<void> {
  const supabase = getSupabase();
  const meta =
    input.meta && Object.keys(input.meta).length > 0
      ? JSON.parse(JSON.stringify(input.meta))
      : undefined;
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const doc = {
    kind: input.kind,
    source: input.source,
    title: input.title.slice(0, 500),
    detail: input.detail ? input.detail.slice(0, 4000) : null,
    actorUserId: input.actorUserId,
    actorName: input.actorName.slice(0, 200),
    actorEmail: input.actorEmail.slice(0, 320),
    actorRole: input.actorRole.slice(0, 64),
    sucursalId: input.sucursalId ?? null,
    route: input.route ? input.route.slice(0, 500) : null,
    meta: meta ?? null,
    createdAt: now,
  };
  const { error } = await supabase.from('app_events').insert({
    id,
    doc,
    created_at: now,
  });
  if (error) throw new Error(error.message);
}

export function subscribeAppEvents(max: number, onList: (list: AppEventLogRecord[]) => void): () => void {
  const supabase = getSupabase();
  const lim = Math.min(max, 500);
  const load = async () => {
    const { data: rows, error } = await supabase
      .from('app_events')
      .select('id, doc')
      .order('created_at', { ascending: false })
      .limit(lim);
    if (error) {
      console.error('appEvents:', error);
      onList([]);
      return;
    }
    const list = (rows ?? []).map((r) => docToAppEvent(r.id, r.doc as Record<string, unknown>));
    onList(list);
  };
  void load();
  // Avoid topic collisions when multiple UI instances mount (mobile/header/sidebar).
  const channelName = `app-events-${crypto.randomUUID()}`;
  const ch = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_events' }, () => {
      void load();
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function deleteAllAppEvents(): Promise<number> {
  const supabase = getSupabase();
  const { data: rows } = await supabase.from('app_events').select('id');
  let removed = 0;
  for (const r of rows ?? []) {
    const { error } = await supabase.from('app_events').delete().eq('id', r.id);
    if (error) throw new Error(error.message);
    removed++;
  }
  return removed;
}
