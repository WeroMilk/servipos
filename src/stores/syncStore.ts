import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SyncState } from '@/types';
import { getPendingSyncCount } from '@/db/database';
import { probeSucursalCloudRoundtrip } from '@/lib/firestore/stateDocsFirestore';

// ============================================
// STORE DE SINCRONIZACIÓN (ONLINE/OFFLINE)
// ============================================

interface SyncStore extends SyncState {
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  updatePendingCount: () => Promise<void>;
  sync: (sucursalId?: string | null) => Promise<void>;
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

      sync: async (sucursalId?: string | null) => {
        const { isOnline, isSyncing } = get();

        if (!isOnline || isSyncing) return;

        set({ isSyncing: true });

        try {
          const sid = sucursalId?.trim();
          if (sid) {
            await probeSucursalCloudRoundtrip(sid);
          }
          await get().updatePendingCount();
          set({
            isSyncing: false,
            lastSyncAt: new Date(),
          });
        } catch (error) {
          console.error('Error en sincronización:', error);
          set({ isSyncing: false });
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
