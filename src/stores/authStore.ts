import { create } from 'zustand';
import type { AuthState, Permission, User } from '@/types';
import { mapProfileRowToUser, userFromAuthOnly } from '@/lib/mapFirestoreUser';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';
import { reportAppEvent } from '@/lib/appEventLog';
import { userHasPermission } from '@/lib/userPermissions';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabaseClient';

async function loadUserProfile(userId: string, email: string | null): Promise<User> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error || !data) {
    return userFromAuthOnly(userId, email);
  }
  return mapProfileRowToUser(data as Parameters<typeof mapProfileRowToUser>[0]);
}

type AuthStore = AuthState;
const LOGIN_EVENT_DEDUP_WINDOW_MS = 60_000;
const lastLoginEventAtByUserId = new Map<string, number>();

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  authReady: false,

  login: async (usernameOrEmail: string, password: string): Promise<boolean> => {
    try {
      const { normalizeServipartzEmail } = await import('@/lib/servipartzAuth');
      const email = normalizeServipartzEmail(usernameOrEmail);
      if (!email) return false;
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const expectedAuthFailure =
          /invalid login|invalid credentials|email not confirmed|user not found/i.test(error.message);
        if (import.meta.env.DEV && !expectedAuthFailure) {
          console.error('Supabase Auth:', error.message);
        }
        return false;
      }
      return true;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Login:', err);
      }
      return false;
    }
  },

  logout: async () => {
    useSucursalContextStore.getState().setActiveSucursalId(null);
    await getSupabase().auth.signOut();
    set({ user: null, isAuthenticated: false });
  },

  hasPermission: (permission: Permission): boolean => {
    const { user } = useAuthStore.getState();
    return userHasPermission(user, permission);
  },

  refreshUserProfile: async () => {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const u = sessionData.session?.user;
    if (!u) return;
    try {
      const user = await loadUserProfile(u.id, u.email ?? null);
      useAuthStore.setState({ user });
    } catch (e) {
      console.error('refreshUserProfile:', e);
    }
  },
}));

/**
 * Aplica sesión → store. Debe ejecutarse FUERA del callback de `onAuthStateChange`
 * (p. ej. vía setTimeout) para no bloquear el lock de Auth al llamar a `supabase.from(...)`.
 * @see https://github.com/supabase/supabase-js — evitar async/await dentro del callback.
 */
type ApplyAuthSessionOptions = {
  reportLoginEvent?: boolean;
};

async function applyAuthSession(
  session: Session | null,
  { reportLoginEvent = true }: ApplyAuthSessionOptions = {}
): Promise<void> {
  if (!session?.user) {
    const prev = useAuthStore.getState().user;
    if (prev?.id) {
      // Permite registrar nuevamente si el usuario cierra sesión y vuelve a entrar.
      lastLoginEventAtByUserId.delete(prev.id);
    }
    useSucursalContextStore.getState().setActiveSucursalId(null);
    if (prev) {
      reportAppEvent({
        kind: 'info',
        source: 'auth',
        title: 'Sesión finalizada',
        detail: prev.email,
        meta: { userId: prev.id, role: prev.role },
      });
    }
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      authReady: true,
    });
    return;
  }
  try {
    const user = await loadUserProfile(session.user.id, session.user.email ?? null);
    useAuthStore.setState({ user, isAuthenticated: true, authReady: true });
    if (reportLoginEvent) {
      reportAppEvent({
        kind: 'success',
        source: 'auth',
        title: 'Sesión iniciada',
        detail: user.email,
        meta: { userId: user.id, role: user.role },
      });
    }
  } catch (e) {
    console.error('Error cargando perfil:', e);
    const user = userFromAuthOnly(session.user.id, session.user.email ?? null);
    useAuthStore.setState({
      user,
      isAuthenticated: true,
      authReady: true,
    });
    if (reportLoginEvent) {
      reportAppEvent({
        kind: 'warning',
        source: 'auth',
        title: 'Sesión iniciada (perfil incompleto)',
        detail: user.email,
        meta: { userId: user.id },
      });
    }
  }
}

function shouldReportLoginEvent(event: AuthChangeEvent, session: Session | null): boolean {
  if (event !== 'SIGNED_IN') return false;
  const nextUserId = session?.user?.id ?? null;
  if (!nextUserId) return false;
  const { isAuthenticated, user } = useAuthStore.getState();
  const currentUserId = user?.id ?? null;
  const isSessionChange = !isAuthenticated || currentUserId !== nextUserId;

  // Supabase puede emitir SIGNED_IN al recuperar foco de pestaña.
  // Solo notificamos cuando la sesión realmente "cambia" desde estado no autenticado.
  if (!isSessionChange) return false;

  // Segundo filtro anti-rebote para evitar duplicados idénticos en ráfaga.
  const now = Date.now();
  const lastReportedAt = lastLoginEventAtByUserId.get(nextUserId) ?? 0;
  if (now - lastReportedAt < LOGIN_EVENT_DEDUP_WINDOW_MS) return false;
  lastLoginEventAtByUserId.set(nextUserId, now);
  return true;
}

/** Suscripción global: sesión Supabase + perfil en `profiles`. */
export function subscribeSupabaseAuth(): () => void {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      // Solo renovación de JWT: no llamar a PostgREST dentro del flujo de auth.
      if (event === 'TOKEN_REFRESHED') return;
      void applyAuthSession(session, {
        reportLoginEvent: shouldReportLoginEvent(event, session),
      });
    }, 0);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
