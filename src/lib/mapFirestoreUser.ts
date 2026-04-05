import type { Permission, User, UserRole } from '@/types';

function timestampToDate(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }
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
  if (s === 'admin' || s === 'administrador') return 'admin';
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
    'inventario:mision_diaria',
    'inventario:mision_ajustar_stock',
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

/** Fila `public.profiles` (Supabase). */
export function mapProfileRowToUser(row: {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  role: string | null;
  is_active: boolean | null;
  sucursal_id: string | null;
  use_custom_permissions: boolean | null;
  custom_permissions: unknown;
  created_at: string;
  updated_at: string;
}): User {
  const email = typeof row.email === 'string' && row.email.length > 0 ? row.email : '';
  return mapFirestoreUserProfile(
    row.id,
    {
      email,
      username: row.username ?? undefined,
      name: row.name ?? undefined,
      role: row.role ?? undefined,
      isActive: row.is_active !== false,
      sucursalId: row.sucursal_id ?? undefined,
      useCustomPermissions: row.use_custom_permissions === true ? true : undefined,
      customPermissions: row.custom_permissions as never,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    email
  );
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
