import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, Toast } from '@/types';

// ============================================
// STORE DE APLICACIÓN (UI/UX)
// ============================================

interface AppStore extends AppState {
  toggleSidebar: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Estado inicial
      isDarkMode: true,
      sidebarCollapsed: false,
      toasts: [],
      isLoading: false,

      toggleSidebar: () => {
        set({ sidebarCollapsed: !get().sidebarCollapsed });
      },

      addToast: (toast: Omit<Toast, 'id'>) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast: Toast = { 
          ...toast, 
          id,
          duration: toast.duration || 3000 
        };
        
        set({ toasts: [...get().toasts, newToast] });

        // Auto-remover después de la duración
        setTimeout(() => {
          get().removeToast(id);
        }, newToast.duration);
      },

      removeToast: (id: string) => {
        set({ toasts: get().toasts.filter(t => t.id !== id) });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },
    }),
    {
      name: 'pos-app-storage',
      partialize: (state) => ({ 
        isDarkMode: state.isDarkMode, 
        sidebarCollapsed: state.sidebarCollapsed 
      }),
    }
  )
);

// Inicializar tema al cargar
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('pos-app-storage');
  if (stored) {
    const { state } = JSON.parse(stored);
    if (state?.isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } else {
    // Por defecto dark mode
    document.documentElement.classList.add('dark');
  }
}
