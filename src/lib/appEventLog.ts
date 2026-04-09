import { getAppEventActorContext } from '@/lib/appEventContext';
import { appendAppEventRecord } from '@/lib/firestore/appEventsFirestore';
import type { AppEventKind } from '@/types';

export type ReportAppEventInput = {
  kind: AppEventKind;
  /** Origen técnico: toast, hook:useSales, auth, sync, navegacion, … */
  source: string;
  title: string;
  detail?: string;
  route?: string;
  meta?: Record<string, unknown>;
};

export type AppEventErrorCode =
  | 'auth'
  | 'rls'
  | 'timeout'
  | 'network'
  | 'validation'
  | 'not_found'
  | 'unknown';

function classifyErrorCode(err: unknown): AppEventErrorCode {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (/jwt|token|session|invalid login|invalid credentials|unauthorized|forbidden|auth/i.test(msg)) {
    return 'auth';
  }
  if (/rls|row-level security|permission|denied|policy|42501|pgrst301/i.test(msg)) return 'rls';
  if (/timeout|timed out|etimedout|abort/i.test(msg)) return 'timeout';
  if (/network|failed to fetch|offline|econn|enotfound/i.test(msg)) return 'network';
  if (/invalid|validation|required|faltan|missing|formato/i.test(msg)) return 'validation';
  if (/not found|no encontrado|404/i.test(msg)) return 'not_found';
  return 'unknown';
}

/**
 * Registra un evento global (todos los usuarios lo ven en el panel).
 * No relanza errores: fallos de red / reglas se ignoran en UI.
 */
export function reportAppEvent(input: ReportAppEventInput): void {
  const actor = getAppEventActorContext();
  const route =
    input.route ??
    (typeof window !== 'undefined' ? window.location.pathname + window.location.search : undefined);

  void appendAppEventRecord({
    kind: input.kind,
    source: input.source,
    title: input.title,
    detail: input.detail,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
    sucursalId: actor.sucursalId,
    route,
    meta: input.meta,
  }).catch(() => {});
}

/** Errores en hooks / capa de datos (cuando no hay toast). */
export function reportHookFailure(source: string, operation: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const errorCode = classifyErrorCode(err);
  reportAppEvent({
    kind: 'error',
    source,
    title: operation,
    detail: msg,
    meta: { errorCode },
  });
}
