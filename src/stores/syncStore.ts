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
          // Aquí iría la lógica de sincronización con el backend
          // Por ahora simulamos una sincronización exitosa
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          set({ 
            isSyncing: false, 
            lastSyncAt: new Date(),
            pendingCount: 0 
          });
          
          reportAppEvent({
            kind: 'success',
            source: 'sync',
            title: 'Sincronización completada',
          });
        } catch (error) {
          console.error('Error en sincronización:', error);
          set({ isSyncing: false });
          reportAppEvent({
            kind: 'error',
            source: 'sync',
            title: 'Error en sincronización',
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
