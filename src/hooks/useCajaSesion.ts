import { useCallback, useEffect, useState } from 'react';
import type { CajaSesion } from '@/types';

export type CajaSesionHookValue = {
  activa: CajaSesion | null;
  loading: boolean;
  isCloud: boolean;
  mustOpenCajaToSell: boolean;
  openCaja: (input: {
    fondoInicial: number;
    openedByUserId: string;
    openedByNombre: string;
  }) => Promise<{ id: string }>;
  closeCaja: (input: {
    conteoDeclarado: number;
    notasCierre?: string;
    closedByUserId: string;
    closedByNombre: string;
    sesionId: string;
  }) => Promise<void>;
  closeLocalOnly: () => void;
};
import {
  closeCajaSessionFirestore,
  openCajaSessionFirestore,
  subscribeCajaSesionAbierta,
} from '@/lib/firestore/cajaFirestore';
import { useCajaLocalStore } from '@/stores/cajaLocalStore';

function localToCajaSesion(s: {
  id: string;
  fondoInicial: number;
  openedAt: string;
  openedByUserId: string;
  openedByNombre: string;
  retirosEfectivoTotal?: number;
  retirosEfectivo?: { id: string; monto: number; notas?: string; createdAt: string; usuarioId: string; usuarioNombre: string }[];
}): CajaSesion {
  return {
    id: s.id,
    estado: 'abierta',
    fondoInicial: s.fondoInicial,
    retirosEfectivoTotal: s.retirosEfectivoTotal,
    retirosEfectivo: s.retirosEfectivo?.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    })),
    openedAt: new Date(s.openedAt),
    openedByUserId: s.openedByUserId,
    openedByNombre: s.openedByNombre,
  };
}

/**
 * Sesión de caja activa: en nube por sucursal (Firestore) o persistida en local si no hay sucursal.
 */
export function useCajaSesion(options: { sucursalId: string | null | undefined }): CajaSesionHookValue {
  const sucursalId = options.sucursalId?.trim() || null;
  const [cloudSession, setCloudSession] = useState<CajaSesion | null>(null);
  const [cloudLoading, setCloudLoading] = useState(!!sucursalId);

  const localSession = useCajaLocalStore((s) => s.session);
  const openLocal = useCajaLocalStore((s) => s.openSession);
  const closeLocal = useCajaLocalStore((s) => s.closeSession);

  useEffect(() => {
    if (!sucursalId) {
      setCloudSession(null);
      setCloudLoading(false);
      return;
    }
    setCloudLoading(true);
    const unsub = subscribeCajaSesionAbierta(sucursalId, (s) => {
      setCloudSession(s);
      setCloudLoading(false);
    });
    return unsub;
  }, [sucursalId]);

  const isCloud = Boolean(sucursalId);
  const activa = isCloud ? cloudSession : localSession ? localToCajaSesion(localSession) : null;
  const loading = isCloud && cloudLoading;

  const openCaja = useCallback(
    async (input: { fondoInicial: number; openedByUserId: string; openedByNombre: string }) => {
      if (sucursalId) {
        return openCajaSessionFirestore(sucursalId, input);
      }
      openLocal(input);
      const sid = useCajaLocalStore.getState().session?.id;
      if (!sid) throw new Error('No se pudo abrir la caja en modo local');
      return { id: sid };
    },
    [sucursalId, openLocal]
  );

  const closeCaja = useCallback(
    async (input: {
      conteoDeclarado: number;
      notasCierre?: string;
      closedByUserId: string;
      closedByNombre: string;
      sesionId: string;
    }) => {
      if (sucursalId) {
        await closeCajaSessionFirestore(sucursalId, input.sesionId, {
          conteoDeclarado: input.conteoDeclarado,
          notasCierre: input.notasCierre,
          closedByUserId: input.closedByUserId,
          closedByNombre: input.closedByNombre,
        });
        return;
      }
      closeLocal();
    },
    [sucursalId, closeLocal]
  );

  /** Requiere caja abierta para cobrar (solo con sucursal en nube). */
  const mustOpenCajaToSell = isCloud;

  return {
    activa,
    loading,
    isCloud,
    mustOpenCajaToSell,
    openCaja,
    closeCaja,
    closeLocalOnly: closeLocal,
  };
}
