import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { MAIN_NAV_ITEMS } from '@/lib/mainNavItems';
import { cn } from '@/lib/utils';

/**
 * Navegación principal fija abajo en móvil (sin sidebar lateral).
 */
export function MobileBottomNav() {
  const location = useLocation();
  const hasPermission = useAuthStore((s) => s.hasPermission);

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
      <div className="no-scrollbar flex h-[3.75rem] w-full items-stretch justify-between gap-0.5 overflow-x-auto pt-0.5 pl-[max(0.25rem,env(safe-area-inset-left,0px))] pr-[max(0.25rem,env(safe-area-inset-right,0px))]">
        {MAIN_NAV_ITEMS.map((item) => {
          if (!hasPermission(item.permission)) return null;
          const Icon = item.icon;
          const isActive =
            item.to === '/'
              ? location.pathname === '/' || location.pathname === ''
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'flex min-w-[3.25rem] max-w-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1 transition-colors',
                'active:scale-[0.98]',
                isActive
                  ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                  : 'text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                className={cn(
                  'h-5 w-5 shrink-0',
                  isActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-400'
                )}
                strokeWidth={isActive ? 2.25 : 2}
                aria-hidden
              />
              <span
                className={cn(
                  'w-full truncate text-center text-[9px] font-medium leading-tight tracking-tight',
                  isActive ? 'text-cyan-800/95 dark:text-cyan-200/95' : 'text-slate-500'
                )}
              >
                {item.shortLabel}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
