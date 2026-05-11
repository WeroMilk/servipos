import { create } from 'zustand';
import type { AuthState, Permission, User } from '@/types';
import { mapProfileRowToUser, userFromAuthOnly } from '@/lib/mapFirestoreUser';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';
import { reportAppEvent } from '@/lib/appEventLog';
import { userHasPermission } from '@/lib/userPermissions';
import type { Session } from '@supabase/supabase-js';
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

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  authReady: false,

  login: async (usernameOrEmail: string, password: string): Promise<boolean> => {
    try {
      const { buildLoginEmailCandidates } = await import('@/lib/servipartzAuth');
      const { looksLikePosPin, syncAuthPasswordFromPosPin } = await import('@/lib/verifyPosPinLogin');
      const candidates = buildLoginEmailCandidates(usernameOrEmail);
      if (candidates.length === 0) return false;

      const supabase = getSupabase();
      const signInWith = (email: string, pwd: string) =>
        supabase.auth.signInWithPassword({ email, password: pwd });

      let anyExpectedAuthFailure = false;
      let lastMessage = '';
      for (const email of candidates) {
        const { error } = await signInWith(email, password);
        if (!error) return true;
        if (error.message) {
          lastMessage = error.message;
          if (
            /invalid login|invalid credentials|email not confirmed|user not found|invalid email|wrong password|invalid password|email address not confirmed|could not find|incorrect password/i.test(
              error.message
            )
          ) {
            anyExpectedAuthFailure = true;
          }
        }
      }

      if (import.meta.env.DEV && !anyExpectedAuthFailure && lastMessage) {
        console.error('Supabase Auth:', lastMessage);
      }

      // PIN de 4–12 dígitos: el primer `signInWithPassword` suele recibir 400 porque GoTrue
      // exige contraseña más larga que el PIN visible; el mensaje no siempre coincide con
      // "invalid credentials", así que no exigimos `anyExpectedAuthFailure` aquí.
      if (!looksLikePosPin(password)) return false;

      let synced = false;
      for (const email of candidates) {
        if (await syncAuthPasswordFromPosPin(email, password)) {
          synced = true;
          break;
        }
      }
      if (!synced) return false;

      const { authPasswordFromPosPin } = await import('@/lib/authPasswordFromPosPin');
      const derived = authPasswordFromPosPin(password);
      for (const email of candidates) {
        const { error } = await signInWith(email, derived);
        if (!error) return true;
      }
      return false;
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
async function applyAuthSession(session: Session | null): Promise<void> {
  if (!session?.user) {
    const prev = useAuthStore.getState().user;
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
  } catch (e) {
    console.error('Error cargando perfil:', e);
    const user = userFromAuthOnly(session.user.id, session.user.email ?? null);
    useAuthStore.setState({
      user,
      isAuthenticated: true,
      authReady: true,
    });
  }
}

/** Suscripción global: sesión Supabase + perfil en `profiles`. */
export function subscribeSupabaseAuth(): () => void {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      // Solo renovación de JWT: no llamar a PostgREST dentro del flujo de auth.
      if (event === 'TOKEN_REFRESHED') return;
      void applyAuthSession(session);
    }, 0);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
