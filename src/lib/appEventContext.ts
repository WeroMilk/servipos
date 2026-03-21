// ============================================
// Contexto para auditoría (evita import circular auth ↔ log)
// ============================================

export type AppEventActorContext = {
  userId: string | null;
  name: string;
  email: string;
  role: string;
  sucursalId?: string;
};

let resolveActor: () => AppEventActorContext = () => ({
  userId: null,
  name: 'Invitado',
  email: '',
  role: 'guest',
  sucursalId: undefined,
});

export function setAppEventActorResolver(fn: () => AppEventActorContext): void {
  resolveActor = fn;
}

export function getAppEventActorContext(): AppEventActorContext {
  return resolveActor();
}
