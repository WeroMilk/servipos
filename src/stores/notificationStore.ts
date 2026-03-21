import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// Panel de notificaciones (eventos globales)
// ============================================

export const useNotificationStore = create<{
  /** Marca de tiempo local: eventos más nuevos muestran el punto en el ícono. */
  eventsLastSeenAtMs: number;
  markEventsPanelSeen: () => void;
}>()(
  persist(
    (set) => ({
      eventsLastSeenAtMs: 0,
      markEventsPanelSeen: () => set({ eventsLastSeenAtMs: Date.now() }),
    }),
    { name: 'servipartz-notif-panel' }
  )
);
