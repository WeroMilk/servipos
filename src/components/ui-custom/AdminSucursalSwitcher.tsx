import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAuthStore, useSucursalContextStore } from '@/stores';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { subscribeSucursales } from '@/lib/firestore/sucursalesMetaFirestore';
import type { Sucursal } from '@/types';
import { cn } from '@/lib/utils';

const PROFILE_VALUE = '__perfil__';

/**
 * Selector de sucursal de trabajo para administradores (persistido en `sucursalContextStore`).
 */
export function AdminSucursalSwitcher() {
  const user = useAuthStore((s) => s.user);
  const activeSucursalId = useSucursalContextStore((s) => s.activeSucursalId);
  const setActiveSucursalId = useSucursalContextStore((s) => s.setActiveSucursalId);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  const canSwitch = Boolean(user?.isActive && user.role === 'admin');

  useEffect(() => {
    if (!canSwitch) return;
    return subscribeSucursales(setSucursales);
  }, [canSwitch]);

  const options = useMemo(() => {
    const active = sucursales.filter((s) => s.activo);
    const selected = activeSucursalId
      ? sucursales.find((s) => s.id === activeSucursalId)
      : null;
    if (activeSucursalId && selected && !selected.activo) {
      return [selected, ...active.filter((s) => s.id !== selected.id)];
    }
    return active;
  }, [sucursales, activeSucursalId]);

  const orphanOverride =
    activeSucursalId && !sucursales.some((s) => s.id === activeSucursalId);

  const selectValue = activeSucursalId ?? PROFILE_VALUE;

  if (!canSwitch) return null;

  return (
    <div className="flex min-w-0 max-w-[min(100vw-8rem,14rem)] items-center gap-1.5 sm:max-w-[16rem]">
      <MapPin className="hidden h-4 w-4 shrink-0 text-cyan-500/90 sm:block" aria-hidden />
      <Select
        value={selectValue}
        onValueChange={(v) => {
          setActiveSucursalId(v === PROFILE_VALUE ? null : v);
        }}
      >
        <SelectTrigger
          className={cn(
            'h-9 min-w-0 flex-1 border-slate-700 bg-slate-800/80 text-xs text-slate-100 sm:text-sm'
          )}
          aria-label="Sucursal de trabajo"
        >
          <SelectValue placeholder="Sucursal" />
        </SelectTrigger>
        <SelectContent className="border-slate-800 bg-slate-900">
          <SelectItem value={PROFILE_VALUE} className="text-slate-100">
            Según mi perfil
          </SelectItem>
          {orphanOverride && activeSucursalId ? (
            <SelectItem value={activeSucursalId} className="text-slate-100">
              Sucursal (id: {activeSucursalId.slice(0, 10)}…)
            </SelectItem>
          ) : null}
          {options.length === 0 && !orphanOverride ? (
            <div className="px-2 py-2 text-xs text-slate-500">
              Cree sucursales en Configuración
            </div>
          ) : (
            options.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-slate-100">
                {s.nombre}
                {s.codigo ? ` (${s.codigo})` : ''}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
