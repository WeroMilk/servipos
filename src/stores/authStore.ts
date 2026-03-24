import { create } from 'zustand';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import type { AuthState, Permission, User } from '@/types';
import { auth, db } from '@/lib/firebase';
import { normalizeServipartzEmail } from '@/lib/servipartzAuth';
import { mapFirestoreUserProfile, userFromAuthOnly } from '@/lib/mapFirestoreUser';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';
import { reportAppEvent } from '@/lib/appEventLog';
import { userHasPermission } from '@/lib/userPermissions';

// ============================================
// STORE DE AUTENTICACIÓN (Firebase Auth + perfil Firestore)
// ============================================

type AuthStore = AuthState;

async function loadUserProfile(firebaseUid: string, email: string | null): Promise<User> {
  const snap = await getDoc(doc(db, 'users', firebaseUid));
  if (!snap.exists()) {
    return userFromAuthOnly(firebaseUid, email);
  }
  return mapFirestoreUserProfile(firebaseUid, snap.data() as Record<string, unknown>, email ?? '');
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  authReady: false,

  login: async (usernameOrEmail: string, password: string): Promise<boolean> => {
    try {
      const email = normalizeServipartzEmail(usernameOrEmail);
      if (!email) return false;
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err) {
      if (err instanceof FirebaseError) {
        console.error('Firebase Auth:', err.code, err.message);
      } else {
        console.error('Login:', err);
      }
      return false;
    }
  },

  logout: async () => {
    useSucursalContextStore.getState().setActiveSucursalId(null);
    await signOut(auth);
    set({ user: null, isAuthenticated: false });
  },

  hasPermission: (permission: Permission): boolean => {
    const { user } = useAuthStore.getState();
    return userHasPermission(user, permission);
  },

  refreshUserProfile: async () => {
    const fbUser = getAuth().currentUser;
    if (!fbUser) return;
    try {
      const user = await loadUserProfile(fbUser.uid, fbUser.email);
      useAuthStore.setState({ user });
    } catch (e) {
      console.error('refreshUserProfile:', e);
    }
  },
}));

/** Suscripción global: mantener sesión y perfil alineados con Firebase. */
export function subscribeFirebaseAuth(): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
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
      const user = await loadUserProfile(fbUser.uid, fbUser.email);
      useAuthStore.setState({ user, isAuthenticated: true, authReady: true });
      reportAppEvent({
        kind: 'success',
        source: 'auth',
        title: 'Sesión iniciada',
        detail: user.email,
        meta: { userId: user.id, role: user.role },
      });
    } catch (e) {
      console.error('Error cargando perfil Firestore:', e);
      const user = userFromAuthOnly(fbUser.uid, fbUser.email);
      useAuthStore.setState({
        user,
        isAuthenticated: true,
        authReady: true,
      });
      reportAppEvent({
        kind: 'warning',
        source: 'auth',
        title: 'Sesión iniciada (perfil Firestore incompleto)',
        detail: user.email,
        meta: { userId: user.id },
      });
    }
  });
}
