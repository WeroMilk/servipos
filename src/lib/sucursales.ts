// ============================================
// IDs de sucursal (multi-tienda; deben coincidir con `public.sucursales` en Supabase)
// ============================================

/** Primer ID = sucursal por defecto (admin sin selección, migración Dexie, ejemplos). */
export const DEFAULT_SUCURSAL_IDS: readonly string[] = parseSucursalIdsFromEnv();

/**
 * Ids que no deben mostrarse en selectores (tienda, usuarios, etc.).
 * Los perfiles que aún tengan uno de estos ids siguen viendo la opción «(id actual)».
 */
export const SUCURSAL_IDS_OCULTAS_UI: readonly string[] = ['matriz'];

export function isSucursalOcultaEnUi(id: string): boolean {
  const t = id.trim().toLowerCase();
  return SUCURSAL_IDS_OCULTAS_UI.some((x) => x.toLowerCase() === t);
}

function parseSucursalIdsFromEnv(): readonly string[] {
  const raw = typeof import.meta.env.VITE_SUCURSAL_IDS === 'string' ? import.meta.env.VITE_SUCURSAL_IDS : '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return Object.freeze([...fromEnv]) as readonly string[];
  return Object.freeze(['principal', 'sucursal_2']) as readonly string[];
}

/** Sucursal usada cuando no hay otra definida (perfil admin vacío, datos viejos en Dexie). */
export function getDefaultSucursalIdForNewData(): string {
  const single = typeof import.meta.env.VITE_DEFAULT_SUCURSAL_ID === 'string'
    ? import.meta.env.VITE_DEFAULT_SUCURSAL_ID.trim()
    : '';
  if (single && DEFAULT_SUCURSAL_IDS.includes(single) && !isSucursalOcultaEnUi(single)) {
    return single;
  }
  const visible = DEFAULT_SUCURSAL_IDS.find((id) => !isSucursalOcultaEnUi(id));
  if (visible) return visible;
  return DEFAULT_SUCURSAL_IDS[0] ?? 'principal';
}

export interface SucursalMeta {
  id: string;
  nombre: string;
  activa: boolean;
}
