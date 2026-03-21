import { useMemo } from 'react';
import { getDefaultSucursalIdForNewData } from '@/lib/sucursales';
import { useAuthStore } from '@/stores/authStore';
import { useSucursalContextStore } from '@/stores/sucursalContextStore';

export function useEffectiveSucursalId(): {
  effectiveSucursalId: string | undefined;
  isAdmin: boolean;
  setActiveSucursalId: (id: string | null) => void;
  activeSucursalId: string | null;
} {
  const user = useAuthStore((s) => s.user);
  const activeSucursalId = useSucursalContextStore((s) => s.activeSucursalId);
  const setActiveSucursalId = useSucursalContextStore((s) => s.setActiveSucursalId);

  const effectiveSucursalId = useMemo(() => {
    if (!user?.isActive) return undefined;
    if (user.role === 'admin') {
      if (activeSucursalId) return activeSucursalId;
      if (user.sucursalId) return user.sucursalId;
      return getDefaultSucursalIdForNewData();
    }
    return user.sucursalId;
  }, [user, activeSucursalId]);

  return {
    effectiveSucursalId,
    isAdmin: user?.role === 'admin',
    setActiveSucursalId,
    activeSucursalId,
  };
}
