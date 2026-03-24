import type { Permission, User, UserRole } from '@/types';

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
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s === 'admin') return 'admin';
  if (s === 'gerente') return 'gerente';
  return 'cashier';
}

function parsePermissionArray(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>([
    'ventas:ver',
    'ventas:crear',
    'inventario:ver',
    'inventario:crear',
    'inventario:editar',
    'inventario:eliminar',
    'cotizaciones:ver',
    'cotizaciones:crear',
    'facturas:ver',
    'facturas:crear',
    'reportes:ver',
    'configuracion:ver',
    'configuracion:editar',
    'usuarios:gestionar',
    'sucursales:gestionar',
    'checador:registrar',
    'checador:reporte',
  ]);
  const out: Permission[] = [];
  for (const x of value) {
    if (typeof x === 'string' && allowed.has(x)) out.push(x as Permission);
  }
  return out;
}

/**
 * Perfil en Firestore: `users/{uid}` (mismo uid que Authentication).
 * Campos usados por la app: `role` ('admin' | 'cashier'), `sucursalId` (id de documento en `sucursales/{id}`),
 * `name`, `email`, `username`, `isActive`, `createdAt`, `updatedAt`.
 */
export function mapFirestoreUserProfile(
  uid: string,
  data: Record<string, unknown>,
  fallbackEmail: string
): User {
  const email =
    typeof data.email === 'string' && data.email.length > 0 ? data.email : fallbackEmail;
  const localPart = email.includes('@') ? email.split('@')[0]! : email;

  const useCustom = data.useCustomPermissions === true;

  return {
    id: uid,
    username: typeof data.username === 'string' && data.username.length > 0 ? data.username : localPart,
    name:
      typeof data.name === 'string' && data.name.length > 0 ? data.name : localPart,
    email,
    role: parseRole(data.role),
    isActive: data.isActive !== false,
    sucursalId: typeof data.sucursalId === 'string' ? data.sucursalId : undefined,
    useCustomPermissions: useCustom ? true : undefined,
    customPermissions: useCustom ? parsePermissionArray(data.customPermissions) : undefined,
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
