import { create } from 'zustand';

/** Punto azul: se oculta al abrir el panel en esta sesión (sin persistir entre recargas). */
export const useNotificationStore = create<{
  panelOpenedOnce: boolean;
  markPanelSeen: () => void;
}>()((set) => ({
  panelOpenedOnce: false,
  markPanelSeen: () => set({ panelOpenedOnce: true }),
}));
