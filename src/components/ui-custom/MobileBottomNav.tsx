import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { userCanSeeInventoryMissions, userCanSeeMissionProgressOnly } from '@/lib/userPermissions';
import { MAIN_NAV_ITEMS } from '@/lib/mainNavItems';
import { SHOW_CHECADOR_NAV } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';

/**
 * Navegación principal fija abajo en móvil (sin sidebar lateral).
 */
export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 md:hidden',
        'border-t border-slate-200/90 bg-white/95 backdrop-blur-xl dark:border-slate-800/90 dark:bg-slate-950/95',
        'pb-[env(safe-area-inset-bottom,0px)]',
        'shadow-[0_-8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.35)]'
      )}
      aria-label="Navegación principal"
    >
      <div className="flex h-[3.5rem] w-full min-w-0 items-stretch justify-between gap-px overflow-x-hidden pt-0.5 pl-[max(0.125rem,env(safe-area-inset-left,0px))] pr-[max(0.125rem,env(safe-area-inset-right,0px))]">
        {MAIN_NAV_ITEMS.map((item) => {
          if (item.desktopOnly) return null;
          if (item.to === '/checador' && !SHOW_CHECADOR_NAV) return null;
          if (item.to === '/mision-inventario') {
            if (!userCanSeeInventoryMissions(user) && !userCanSeeMissionProgressOnly(user)) return null;
          } else if (!hasPermission(item.permission)) return null;
          const Icon = item.icon;
          const isActive =
            item.to === '/'
              ? location.pathname === '/' || location.pathname === ''
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

          return (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
              aria-label={item.label}
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-px rounded-lg border border-transparent bg-transparent px-px py-0.5 transition-colors',
                'active:scale-[0.98]',
                isActive
                  ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                  : 'text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                className={cn(
                  'h-[1.05rem] w-[1.05rem] shrink-0 sm:h-4 sm:w-4',
                  isActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-400'
                )}
                strokeWidth={isActive ? 2.25 : 2}
                aria-hidden
              />
              <span
                className={cn(
                  'w-full max-w-full truncate px-px text-center text-[7px] font-medium leading-none tracking-tight sm:text-[8px]',
                  isActive ? 'text-cyan-800/95 dark:text-cyan-200/95' : 'text-slate-500'
                )}
              >
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
