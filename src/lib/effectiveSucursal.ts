import { getDefaultSucursalIdForNewData } from '@/lib/sucursales';
import { useAuthStore } from '@/stores/authStore';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';

/**
 * Sucursal efectiva para lecturas/escrituras Firestore y datos locales filtrados.
 * - Cajero: siempre `user.sucursalId` del perfil Firestore.
 * - Admin: `activeSucursalId` del contexto; si falta, `user.sucursalId` o default de entorno.
 */
export function getEffectiveSucursalId(): string | undefined {
  const user = useAuthStore.getState().user;
  if (!user?.isActive) return undefined;
  if (user.role === 'admin') {
    const active = useSucursalContextStore.getState().activeSucursalId;
    if (active) return active;
    if (user.sucursalId) return user.sucursalId;
    return getDefaultSucursalIdForNewData();
  }
  return user.sucursalId;
}
