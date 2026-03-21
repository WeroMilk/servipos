import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User, UserRole } from '@/types';
import { mapFirestoreUserProfile } from '@/lib/mapFirestoreUser';

const USERS = 'users';

/** Lista usuarios con perfil en Firestore (colección `users`). */
export function subscribeFirestoreDirectoryUsers(onList: (list: User[]) => void): Unsubscribe {
  const q = collection(db, USERS);
  return onSnapshot(
    q,
    (snap) => {
      const list: User[] = [];
      snap.forEach((s) => {
        const data = s.data() as Record<string, unknown>;
        const email = typeof data.email === 'string' ? data.email : '';
        list.push(mapFirestoreUserProfile(s.id, data, email));
      });
      list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      onList(list);
    },
    (err) => {
      console.error('Users directory:', err);
      onList([]);
    }
  );
}

export async function fetchFirestoreDirectoryUsersOnce(): Promise<User[]> {
  const snap = await getDocs(collection(db, USERS));
  const list: User[] = [];
  snap.forEach((s) => {
    const data = s.data() as Record<string, unknown>;
    const email = typeof data.email === 'string' ? data.email : '';
    list.push(mapFirestoreUserProfile(s.id, data, email));
  });
  list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return list;
}

export async function updateFirestoreDirectoryUser(
  uid: string,
  patch: {
    name?: string;
    username?: string;
    email?: string;
    role?: UserRole;
    isActive?: boolean;
    sucursalId?: string | null;
  }
): Promise<void> {
  const ref = doc(db, USERS, uid);
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.username !== undefined) payload.username = patch.username;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.role !== undefined) payload.role = patch.role;
  if (patch.isActive !== undefined) payload.isActive = patch.isActive;
  if (patch.sucursalId !== undefined) {
    payload.sucursalId = patch.sucursalId === null || patch.sucursalId === '' ? null : patch.sucursalId;
  }
  await updateDoc(ref, payload);
}

/**
 * Crea cuenta en Firebase Auth vía Identity Toolkit REST (no cambia la sesión actual)
 * y escribe perfil en `users/{uid}`.
 */
export async function createAuthUserAndProfile(input: {
  email: string;
  password: string;
  name: string;
  username?: string;
  role: UserRole;
  sucursalId?: string | null;
}): Promise<string> {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  if (!apiKey) throw new Error('Falta VITE_FIREBASE_API_KEY');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        returnSecureToken: true,
      }),
    }
  );
  const json = (await res.json()) as {
    localId?: string;
    error?: { message: string };
  };
  if (!res.ok || !json.localId) {
    const code = json.error?.message ?? 'Error al crear cuenta';
    if (code.includes('EMAIL_EXISTS')) {
      throw new Error('Ese correo ya está registrado. Asigne sucursal desde la lista de usuarios.');
    }
    throw new Error(code);
  }

  const uid = json.localId;
  const ref = doc(db, USERS, uid);
  const username =
    input.username?.trim() ||
    (input.email.includes('@') ? input.email.split('@')[0]! : input.email);
  await setDoc(ref, {
    email: input.email.trim(),
    username,
    name: input.name.trim(),
    role: input.role,
    isActive: true,
    sucursalId: input.sucursalId && input.sucursalId.length > 0 ? input.sucursalId : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return uid;
}
