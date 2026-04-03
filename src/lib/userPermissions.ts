import type { Permission, User, UserRole } from '@/types';

/** Todos los permisos conocidos (orden estable para UI). */
export const ALL_PERMISSIONS: Permission[] = [
  'ventas:ver',
  'ventas:crear',
  'inventario:ver',
  'inventario:crear',
  'inventario:editar',
  'inventario:eliminar',
  'inventario:mision_diaria',
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
];

const ALL_SET = new Set<string>(ALL_PERMISSIONS);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'ventas:ver': 'Panel, historial del día, Clientes y Cuentas por cobrar',
  'ventas:crear': 'Punto de venta (cobrar)',
  'inventario:ver': 'Ver inventario',
  'inventario:crear': 'Alta de productos',
  'inventario:editar': 'Editar productos y existencias',
  'inventario:eliminar': 'Eliminar productos',
  'inventario:mision_diaria': 'Misiones de inventario diario (revisar artículos del día)',
  'cotizaciones:ver': 'Ver cotizaciones',
  'cotizaciones:crear': 'Crear y editar cotizaciones',
  'facturas:ver': 'Facturación (ver)',
  'facturas:crear': 'Generar facturas',
  'reportes:ver': 'Reportes y métricas del panel',
  'configuracion:ver': 'Abrir configuración (lectura)',
  'configuracion:editar': 'Editar listas de precios, inventario y ajustes',
  'usuarios:gestionar': 'Usuarios y permisos',
  'sucursales:gestionar': 'Administrar sucursales',
  'checador:registrar': 'Checador (registrar entradas/salidas)',
  'checador:reporte': 'Reportes de asistencia (checador)',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  cashier: 'Cajero',
};

/** Administrador: acceso total (incl. usuarios y sucursales). */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  /** Gerente (nivel Zavala): igual que admin salvo gestión de usuarios y sucursales. */
  gerente: ALL_PERMISSIONS.filter((p) => p !== 'usuarios:gestionar' && p !== 'sucursales:gestionar'),
  cashier: [
    'ventas:ver',
    'ventas:crear',
    'inventario:ver',
    'cotizaciones:ver',
    'cotizaciones:crear',
    'checador:registrar',
  ],
};

function normalizePermissionList(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  const out: Permission[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && ALL_SET.has(x)) out.push(x as Permission);
  }
  return out;
}

/** Permisos efectivos según rol y, si aplica, lista personalizada en el perfil. */
export function getEffectivePermissions(user: User | null | undefined): Permission[] {
  if (!user || !user.isActive) return [];

  if (user.useCustomPermissions === true) {
    const list = normalizePermissionList(user.customPermissions);
    return list.length > 0 ? [...new Set(list)] : [];
  }

  const role = user.role;
  const base = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.cashier;
  return [...base];
}

export function userHasPermission(user: User | null | undefined, permission: Permission): boolean {
  return getEffectivePermissions(user).includes(permission);
}

export function permissionsFromRoleTemplate(role: UserRole): Permission[] {
  return [...(ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.cashier)];
}
