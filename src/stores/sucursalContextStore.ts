import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// Contexto de sucursal activa (solo admin en UI)
// ============================================

type SucursalContextState = {
  /** Sucursal en la que opera el admin (POS / inventario / ventas). */
  activeSucursalId: string | null;
  setActiveSucursalId: (id: string | null) => void;
};

export const useSucursalContextStore = create<SucursalContextState>()(
  persist(
    (set) => ({
      activeSucursalId: null,
      setActiveSucursalId: (id) => set({ activeSucursalId: id }),
    }),
    { name: 'servipartz-sucursal-context' }
  )
);
