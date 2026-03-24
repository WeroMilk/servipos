import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SyncState } from '@/types';
import { getPendingSyncCount } from '@/db/database';
import { reportAppEvent } from '@/lib/appEventLog';

// ============================================
// STORE DE SINCRONIZACIÓN (ONLINE/OFFLINE)
// ============================================

interface SyncStore extends SyncState {
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  updatePendingCount: () => Promise<void>;
  sync: () => Promise<void>;
  checkConnection: () => void;
}

export const useSyncStore = create<SyncStore>()(
  persist(
    (set, get) => ({
      // Estado inicial
      isOnline: navigator.onLine,
      isSyncing: false,
      lastSyncAt: undefined,
      pendingCount: 0,

      // Acciones
      setOnline: (online: boolean) => {
        set({ isOnline: online });
      },

      setSyncing: (syncing: boolean) => {
        set({ isSyncing: syncing });
      },

      updatePendingCount: async () => {
        const count = await getPendingSyncCount();
        set({ pendingCount: count });
      },

      sync: async () => {
        const { isOnline, isSyncing } = get();

        if (!isOnline || isSyncing) return;

        set({ isSyncing: true });

        try {
          await get().updatePendingCount();
          set({
            isSyncing: false,
            lastSyncAt: new Date(),
          });
          reportAppEvent({
            kind: 'success',
            source: 'sync',
            title: 'Estado de cola local actualizado',
          });
        } catch (error) {
          console.error('Error en sincronización:', error);
          set({ isSyncing: false });
          reportAppEvent({
            kind: 'error',
            source: 'sync',
            title: 'Error al actualizar estado',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      },

      checkConnection: () => {
        const online = navigator.onLine;
        set({ isOnline: online });
        
        if (online) {
          // Intentar sincronizar al recuperar conexión
          get().sync();
        }
      },
    }),
    {
      name: 'pos-sync-storage',
      partialize: (state) => ({ 
        lastSyncAt: state.lastSyncAt 
      }),
    }
  )
);

// Event listeners para cambios de conexión
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useSyncStore.getState().setOnline(true);
    useSyncStore.getState().sync();
  });

  window.addEventListener('offline', () => {
    useSyncStore.getState().setOnline(false);
  });
}
