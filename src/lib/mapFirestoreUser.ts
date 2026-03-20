import type { User, UserRole } from '@/types';

function timestampToDate(value: unknown): Date {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

function parseRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'cashier';
}

/** Perfil en Firestore: colección `users`, id = UID de Authentication. */
export function mapFirestoreUserProfile(
  uid: string,
  data: Record<string, unknown>,
  fallbackEmail: string
): User {
  const email =
    typeof data.email === 'string' && data.email.length > 0 ? data.email : fallbackEmail;
  const localPart = email.includes('@') ? email.split('@')[0]! : email;

  return {
    id: uid,
    username: typeof data.username === 'string' && data.username.length > 0 ? data.username : localPart,
    name:
      typeof data.name === 'string' && data.name.length > 0 ? data.name : localPart,
    email,
    role: parseRole(data.role),
    isActive: data.isActive !== false,
    sucursalId: typeof data.sucursalId === 'string' ? data.sucursalId : undefined,
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt),
  };
}

export function userFromAuthOnly(uid: string, email: string | null): User {
  const safeEmail = email ?? '';
  const localPart = safeEmail.includes('@') ? safeEmail.split('@')[0]! : safeEmail || uid;
  return {
    id: uid,
    username: localPart,
    name: localPart,
    email: safeEmail,
    role: 'cashier',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
