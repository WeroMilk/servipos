import { create } from 'zustand';
import type { AuthState, Permission, User } from '@/types';
import { mapProfileRowToUser, userFromAuthOnly } from '@/lib/mapFirestoreUser';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';
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

  login: async (usernameOrEmail: string, password: string, opts?: { pinSyncExactEmailOnly?: boolean }) => {
    try {
      const { buildLoginEmailCandidates } = await import('@/lib/servipartzAuth');
      const { looksLikePosPin, syncAuthPasswordFromPosPin } = await import('@/lib/verifyPosPinLogin');
      const candidates = buildLoginEmailCandidates(usernameOrEmail);
      const pinSyncEmails =
        opts?.pinSyncExactEmailOnly === true
          ? buildLoginEmailCandidates(usernameOrEmail, { includeDomainAliases: false })
          : candidates;
      if (candidates.length === 0) return { success: false };

      const supabase = getSupabase();
      const signInWith = (email: string, pwd: string) =>
        supabase.auth.signInWithPassword({ email, password: pwd });

      // PIN numérico: Auth guarda `Pos-{pin}-Pin`. Primero alinear vía Edge; solo después signIn.
      // Evita 400 previos en /auth/v1/token cuando el PIN es incorrecto o aún no estaba sincronizado.
      if (looksLikePosPin(password)) {
        const { authPasswordFromPosPin } = await import('@/lib/authPasswordFromPosPin');
        const derived = authPasswordFromPosPin(password);
        const signInEmails =
          opts?.pinSyncExactEmailOnly === true ? pinSyncEmails : candidates;

        let synced = false;
        let pinDenied = false;
        let sawInfraFailure = false;
        let pinSyncHint: string | undefined;
        const fmt = (msg: string | undefined, code?: string) =>
          code ? `[${code}] ${msg ?? ''}`.trim() : (msg ?? '');

        for (const email of pinSyncEmails) {
          const r = await syncAuthPasswordFromPosPin(email, password);
          if (r.ok) {
            synced = true;
            break;
          }
          // Sin perfil en este correo: probar alias. PIN/perfil inválido: cortar sin llamar a Auth.
          if (r.status === 401 || r.status === 400 || r.status === 409) {
            if (pinSyncHint === undefined) {
              pinSyncHint = fmt(r.error ?? 'No autorizado', r.code);
            }
            if (r.code === 'NO_PROFILE_FOR_EMAIL') {
              continue;
            }
            pinDenied = true;
            break;
          }
          sawInfraFailure = true;
          if (r.status >= 500) {
            pinSyncHint = fmt(
              r.error ??
                'No se pudo sincronizar el PIN (error del servidor). Revise logs de verify-pos-pin-login en Supabase y vuelva a desplegar la función.',
              r.code
            );
          } else if (pinSyncHint === undefined && r.status === 403) {
            pinSyncHint = fmt(
              'Origen no permitido para verify-pos-pin-login. Añada la URL de la app a ADMIN_CREATE_USER_ALLOWED_ORIGINS.',
              r.code
            );
          } else if (pinSyncHint === undefined && r.status === 0) {
            pinSyncHint = fmt('No se pudo contactar verify-pos-pin-login (red o bloqueo).', r.code);
          } else if (pinSyncHint === undefined && r.error) {
            pinSyncHint = fmt(r.error, r.code);
          }
        }

        // Solo NO_PROFILE en todos los correos: denegar sin /auth/token (evita 400 en consola).
        if (!synced && !pinDenied && !sawInfraFailure) {
          pinDenied = true;
        }

        if (pinDenied) {
          return { success: false, message: pinSyncHint };
        }

        for (const email of signInEmails) {
          const { error } = await signInWith(email, derived);
          if (!error) return { success: true };
        }

        // Sync falló por infra (red/origen/5xx) pero Auth ya tenía la clave: el signIn de arriba pudo bastar.
        // Si tampoco entró, devolver el hint del sync.
        if (!synced) {
          return { success: false, message: pinSyncHint };
        }
        return { success: false };
      }

      let anyExpectedAuthFailure = false;
      let lastMessage = '';
      for (const email of candidates) {
        const { error } = await signInWith(email, password);
        if (!error) return { success: true };
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

      return { success: false };
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Login:', err);
      }
      return { success: false };
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

let authStorageRecoveryOnce = false;
let supabaseAuthRefCount = 0;
let supabaseAuthTeardown: (() => void) | null = null;

function scheduleCorruptSessionCleanupOnce(): void {
  if (authStorageRecoveryOnce) return;
  authStorageRecoveryOnce = true;
  const supabase = getSupabase();
  void supabase.auth
    .getSession()
    .then(({ error }) => {
      if (!error) return;
      const m = error.message.toLowerCase();
      // Sesión en localStorage inválida tras cambio de contraseña u otros; evita rechazos sin capturar en GoTrue.
      if (/(refresh|jwt|invalid|session|expired|malformed)/i.test(m)) {
        void supabase.auth.signOut({ scope: 'local' });
      }
    })
    .catch(() => {
      void supabase.auth.signOut({ scope: 'local' });
    });
}

/**
 * Aplica sesión → store. Debe ejecutarse FUERA del callback de `onAuthStateChange`
 * (p. ej. vía setTimeout) para no bloquear el lock de Auth al llamar a `supabase.from(...)`.
 * @see https://github.com/supabase/supabase-js — evitar async/await dentro del callback.
 */
async function applyAuthSession(session: Session | null, event?: string): Promise<void> {
  if (!session?.user) {
    if (event === 'SIGNED_OUT') {
      const { data: fresh } = await getSupabase().auth.getSession();
      if (fresh.session?.user) {
        await applyAuthSession(fresh.session, event);
        return;
      }
    }
    useSucursalContextStore.getState().setActiveSucursalId(null);
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      authReady: true,
    });
    return;
  }
  const current = useAuthStore.getState();
  if (
    current.isAuthenticated &&
    current.user?.id === session.user.id &&
    event !== 'USER_UPDATED' &&
    event !== 'PASSWORD_RECOVERY'
  ) {
    useAuthStore.setState({ authReady: true });
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
  scheduleCorruptSessionCleanupOnce();

  supabaseAuthRefCount += 1;
  if (!supabaseAuthTeardown) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (event === 'TOKEN_REFRESHED') return;
        void applyAuthSession(session, event).catch((err) => {
          console.error('applyAuthSession:', err);
          useSucursalContextStore.getState().setActiveSucursalId(null);
          useAuthStore.setState({
            user: null,
            isAuthenticated: false,
            authReady: true,
          });
        });
      }, 0);
    });
    supabaseAuthTeardown = () => {
      data.subscription.unsubscribe();
      supabaseAuthTeardown = null;
    };
  }

  return () => {
    supabaseAuthRefCount -= 1;
    if (supabaseAuthRefCount <= 0) {
      supabaseAuthRefCount = 0;
      supabaseAuthTeardown?.();
    }
  };
}
