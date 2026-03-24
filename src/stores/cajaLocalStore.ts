import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Sesión de caja en modo solo Dexie (sin Firestore por sucursal). */
export type LocalCajaSession = {
  id: string;
  fondoInicial: number;
  openedAt: string;
  openedByUserId: string;
  openedByNombre: string;
};

type CajaLocalState = {
  session: LocalCajaSession | null;
  openSession: (input: {
    fondoInicial: number;
    openedByUserId: string;
    openedByNombre: string;
  }) => void;
  closeSession: () => void;
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
    }),
    { name: 'servipartz-caja-local' }
  )
);
