import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CajaRetiroEfectivo } from '@/types';

/** Persistido en JSON: `createdAt` como ISO string. */
export type LocalCajaRetiroPersisted = Omit<CajaRetiroEfectivo, 'createdAt'> & { createdAt: string };

/** Sesión de caja en modo solo Dexie (sin Firestore por sucursal). */
export type LocalCajaSession = {
  id: string;
  fondoInicial: number;
  openedAt: string;
  openedByUserId: string;
  openedByNombre: string;
  retirosEfectivoTotal?: number;
  retirosEfectivo?: LocalCajaRetiroPersisted[];
};

type CajaLocalState = {
  session: LocalCajaSession | null;
  openSession: (input: {
    fondoInicial: number;
    openedByUserId: string;
    openedByNombre: string;
  }) => void;
  closeSession: () => void;
  addRetiroEfectivo: (input: {
    monto: number;
    notas?: string;
    usuarioId: string;
    usuarioNombre: string;
  }) => void;
};

export const useCajaLocalStore = create<CajaLocalState>()(
  persist(
    (set) => ({
      session: null,
      openSession: (input) =>
        set({
          session: {
            id: crypto.randomUUID(),
            fondoInicial: Math.max(0, Number(input.fondoInicial) || 0),
            openedAt: new Date().toISOString(),
            openedByUserId: input.openedByUserId,
            openedByNombre: input.openedByNombre.trim() || 'Usuario',
          },
        }),
      closeSession: () => set({ session: null }),
      addRetiroEfectivo: (input) => {
        const monto = Math.round(Math.max(0, Number(input.monto) || 0) * 100) / 100;
        if (monto <= 0) return;
        set((state) => {
          if (!state.session) return state;
          const prev = state.session.retirosEfectivo ?? [];
          const totalPrev = state.session.retirosEfectivoTotal ?? 0;
          const row: LocalCajaRetiroPersisted = {
            id: crypto.randomUUID(),
            monto,
            notas: input.notas?.trim() || undefined,
            createdAt: new Date().toISOString(),
            usuarioId: input.usuarioId,
            usuarioNombre: input.usuarioNombre.trim() || 'Usuario',
          };
          return {
            session: {
              ...state.session,
              retirosEfectivo: [...prev, row],
              retirosEfectivoTotal: Math.round((totalPrev + monto) * 100) / 100,
            },
          };
        });
      },
    }),
    { name: 'servipartz-caja-local' }
  )
);
