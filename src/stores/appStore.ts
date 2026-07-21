import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentColor, AppState, ThemePreference, Toast } from '@/types';

// ============================================
// STORE DE APLICACIÓN (UI/UX)
// ============================================

const STORAGE_KEY = 'pos-app-storage';
const PERSIST_VERSION = 3;

export const ACCENT_COLORS: readonly AccentColor[] = [
  'blue',
  'sky',
  'teal',
  'emerald',
  'green',
  'lime',
  'amber',
  'orange',
  'rose',
  'pink',
  'violet',
  'indigo',
] as const;

const ACCENT_SET = new Set<string>(ACCENT_COLORS);

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && ACCENT_SET.has(value);
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getResolvedIsDark(s: Pick<AppState, 'themePreference' | 'systemPrefersDark'>): boolean {
  if (s.themePreference === 'light') return false;
  if (s.themePreference === 'dark') return true;
  return s.systemPrefersDark;
}

export function applyDomTheme(isDark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', isDark ? '#0f172a' : '#f1f5f9');
  }
}

export function applyDomAccent(color: AccentColor): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-accent', color);
}

function migratePersisted(
  persisted: unknown
): Pick<AppState, 'themePreference' | 'sidebarCollapsed' | 'accentColor'> {
  const p = persisted as {
    themePreference?: ThemePreference;
    isDarkMode?: boolean;
    sidebarCollapsed?: boolean;
    accentColor?: unknown;
  } | null;
  const sidebarCollapsed = Boolean(p?.sidebarCollapsed);
  const accentColor: AccentColor = isAccentColor(p?.accentColor) ? p.accentColor : 'blue';

  if (p?.themePreference === 'system' || p?.themePreference === 'light' || p?.themePreference === 'dark') {
    return { themePreference: p.themePreference, sidebarCollapsed, accentColor };
  }
  if (typeof p?.isDarkMode === 'boolean') {
    return { themePreference: p.isDarkMode ? 'dark' : 'light', sidebarCollapsed, accentColor };
  }
  return { themePreference: 'system', sidebarCollapsed, accentColor };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      themePreference: 'system',
      systemPrefersDark: getSystemPrefersDark(),
      accentColor: 'blue',
      sidebarCollapsed: false,
      toasts: [],
      isLoading: false,

      toggleTheme: () => {
        const dark = getResolvedIsDark(get());
        set({ themePreference: dark ? 'light' : 'dark' });
        applyDomTheme(!dark);
      },

      setAccentColor: (color: AccentColor) => {
        set({ accentColor: color });
        applyDomAccent(color);
      },

      toggleSidebar: () => {
        set({ sidebarCollapsed: !get().sidebarCollapsed });
      },

      addToast: (toast: Omit<Toast, 'id'>) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast: Toast = {
          ...toast,
          id,
          duration: toast.duration || 3000,
        };

        set({ toasts: [...get().toasts, newToast] });

        setTimeout(() => {
          get().removeToast(id);
        }, newToast.duration);
      },

      removeToast: (id: string) => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      migrate: (persisted, version) => {
        void version;
        return migratePersisted(persisted);
      },
      partialize: (state) => ({
        themePreference: state.themePreference,
        sidebarCollapsed: state.sidebarCollapsed,
        accentColor: state.accentColor,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        const sys = getSystemPrefersDark();
        useAppStore.setState({ systemPrefersDark: sys });
        applyDomTheme(getResolvedIsDark({ ...state, systemPrefersDark: sys }));
        applyDomAccent(isAccentColor(state.accentColor) ? state.accentColor : 'blue');
      },
    }
  )
);

if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    const matches = mq.matches;
    useAppStore.setState({ systemPrefersDark: matches });
    const s = useAppStore.getState();
    if (s.themePreference === 'system') {
      applyDomTheme(matches);
    }
  };
  mq.addEventListener('change', onSystemChange);

  const syncFromStorageEarly = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        applyDomTheme(getResolvedIsDark(useAppStore.getState()));
        applyDomAccent(useAppStore.getState().accentColor);
        return;
      }
      const parsed = JSON.parse(raw) as { state?: unknown; version?: number };
      const migrated = migratePersisted(parsed.state ?? parsed);
      const sys = getSystemPrefersDark();
      const dark = getResolvedIsDark({ ...migrated, systemPrefersDark: sys });
      applyDomTheme(dark);
      applyDomAccent(migrated.accentColor);
    } catch {
      applyDomTheme(getResolvedIsDark(useAppStore.getState()));
      applyDomAccent(useAppStore.getState().accentColor);
    }
  };
  syncFromStorageEarly();
}
