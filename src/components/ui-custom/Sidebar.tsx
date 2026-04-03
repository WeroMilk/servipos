// Sidebar — solo escritorio/tablet (md+). En móvil usa MobileBottomNav.
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { Cloud, CloudOff } from 'lucide-react';
import { useAuthStore, useSyncStore } from '@/stores';
import { cn } from '@/lib/utils';
import { MAIN_NAV_ITEMS } from '@/lib/mainNavItems';
import { SHOW_CHECADOR_NAV } from '@/lib/featureFlags';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { ROLE_LABELS, userCanSeeInventoryMissions } from '@/lib/userPermissions';
interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
}

function NavItem({ to, icon: Icon, label }: NavItemProps) {
  const location = useLocation();
  const isActive =
    to === '/'
      ? location.pathname === '/' || location.pathname === ''
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      title={label}
      aria-label={label}
      className={cn(
        'group relative flex items-center justify-center gap-0 rounded-xl px-2 py-3 transition-all duration-200 xl:justify-start xl:gap-3 xl:px-4',
        'hover:bg-slate-200/80 hover:shadow-lg hover:shadow-cyan-500/10 dark:hover:bg-slate-800/50',
        isActive
          ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-700 shadow-lg shadow-cyan-500/15 dark:text-cyan-400 dark:shadow-cyan-500/20'
          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5 shrink-0 transition-all duration-200',
          isActive ? 'text-cyan-600 dark:text-cyan-400' : 'group-hover:text-cyan-600 dark:group-hover:text-cyan-300'
        )}
      />

      <span className="hidden text-sm font-medium xl:inline">{label}</span>

      {isActive ? (
        <div className="absolute right-1 hidden h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400 xl:right-2 xl:block" />
      ) : null}
    </NavLink>
  );
}

export function Sidebar() {
  const { user } = useAuthStore();
  const { isOnline, pendingCount } = useSyncStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-dvh w-20 min-w-[5rem] flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/95 md:flex xl:w-72 xl:min-w-[18rem]'
      )}
    >
      <NavLink
        to="/"
        className={cn(
          'flex h-14 shrink-0 items-center justify-center gap-0 border-b border-slate-200/80 px-2 transition-colors dark:border-slate-800/50 sm:h-16 xl:justify-start xl:gap-3 xl:px-3',
          'hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 dark:hover:bg-slate-800/30'
        )}
        aria-label="Ir al panel de inicio"
        title="SERVIPARTZ POS · inicio"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-slate-300/80 dark:ring-slate-700/50 sm:h-11 sm:w-11">
          <img
            src={BRAND_LOGO_URL}
            alt=""
            className="h-full w-full object-cover"
            width={44}
            height={44}
            decoding="async"
          />
        </div>
        <div className="hidden min-w-0 leading-tight xl:block">
          <p className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">SERVIPARTZ POS</p>
          <p className="truncate text-[11px] text-slate-600 dark:text-slate-500 sm:text-xs">Panel · inicio</p>
        </div>
      </NavLink>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain p-2 pt-2 xl:p-3">
        {MAIN_NAV_ITEMS.map((item) => {
          if (item.to === '/checador' && !SHOW_CHECADOR_NAV) return null;
          if (item.to === '/mision-inventario') {
            return userCanSeeInventoryMissions(user) ? (
              <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
            ) : null;
          }
          return hasPermission(item.permission) ? (
            <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
          ) : null;
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-200/80 p-2 dark:border-slate-800/50 xl:p-4">
        <div
          className={cn(
            'hidden items-center gap-2 rounded-lg px-3 py-2 text-xs xl:flex',
            isOnline
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-800 dark:text-amber-400'
          )}
        >
          {isOnline ? (
            <>
              <Cloud className="h-4 w-4 shrink-0" />
              <span>En línea</span>
            </>
          ) : (
            <>
              <CloudOff className="h-4 w-4 shrink-0" />
              <span>Sin conexión</span>
            </>
          )}
        </div>

        <div
          className={cn(
            'flex flex-col items-center gap-1 rounded-lg py-2 xl:hidden',
            isOnline
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-800 dark:text-amber-400'
          )}
          title={isOnline ? 'En línea' : 'Sin conexión'}
        >
          {isOnline ? <Cloud className="h-5 w-5 shrink-0" /> : <CloudOff className="h-5 w-5 shrink-0" />}
        </div>

        {pendingCount > 0 ? (
          <div
            className="mt-2 hidden items-center gap-2 rounded-lg bg-cyan-500/10 px-3 py-2 text-xs text-cyan-800 dark:text-cyan-400 xl:flex"
            title="Registros en IndexedDB con syncStatus pendiente (cola local). Ver barra superior para más detalle."
          >
            <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-600 dark:bg-cyan-400" />
            <span>
              {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
            </span>
          </div>
        ) : null}

        {pendingCount > 0 ? (
          <div
            className="mt-2 flex justify-center xl:hidden"
            title={`${pendingCount} registro(s) en cola local (IndexedDB).`}
          >
            <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-600 dark:bg-cyan-400" />
          </div>
        ) : null}

        {user ? (
          <div className="mt-2 hidden border-t border-slate-200/80 pt-3 dark:border-slate-800/50 xl:block">
            <p className="text-xs text-slate-600 dark:text-slate-500">Usuario</p>
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-300">{user.name}</p>
            <p className="text-xs text-slate-600 dark:text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
        ) : null}

        {user ? (
          <div className="mt-2 border-t border-slate-200/80 pt-2 xl:hidden dark:border-slate-800/50" title={user.name}>
            <p className="truncate text-center text-[10px] font-medium leading-tight text-slate-700 dark:text-slate-300">
              {user.name}
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
