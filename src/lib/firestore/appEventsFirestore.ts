import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { AppEventKind, AppEventLogRecord } from '@/types';

const COL = 'appEvents';

function tsToDate(v: unknown): Date {
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
  const meta =
    input.meta && Object.keys(input.meta).length > 0
      ? JSON.parse(JSON.stringify(input.meta))
      : undefined;
  await addDoc(collection(db, COL), {
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
    createdAt: serverTimestamp(),
  });
}

export function subscribeAppEvents(
  max: number,
  onList: (list: AppEventLogRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'), limit(Math.min(max, 500)));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((s) => docToAppEvent(s.id, s.data() as Record<string, unknown>));
      onList(list);
    },
    (err) => {
      console.error('appEvents:', err);
      onList([]);
    }
  );
}

/** Solo administración: borra todos los documentos de `appEvents` (en lotes). */
export async function deleteAllAppEvents(): Promise<number> {
  let removed = 0;
  // Repetir hasta vaciar (cada consulta trae hasta 500)
  for (;;) {
    const snap = await getDocs(query(collection(db, COL), limit(500)));
    if (snap.empty) break;
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, COL, d.id))));
    removed += snap.docs.length;
    if (snap.docs.length < 500) break;
  }
  return removed;
}
