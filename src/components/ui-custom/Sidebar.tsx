// Sidebar — solo escritorio/tablet (md+). En móvil usa MobileBottomNav.
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Cloud, CloudOff } from 'lucide-react';
import { useAppStore, useAuthStore, useSyncStore } from '@/stores';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { MAIN_NAV_ITEMS } from '@/lib/mainNavItems';

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon: Icon, label, collapsed }: NavItemProps) {
  const location = useLocation();
  const isActive =
    to === '/'
      ? location.pathname === '/' || location.pathname === ''
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200',
        'hover:bg-slate-800/50 hover:shadow-lg hover:shadow-cyan-500/10',
        isActive
          ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 shadow-lg shadow-cyan-500/20'
          : 'text-slate-400 hover:text-slate-100'
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5 transition-all duration-200',
          isActive ? 'text-cyan-400' : 'group-hover:text-cyan-300'
        )}
      />

      {!collapsed && <span className="text-sm font-medium">{label}</span>}

      {collapsed && (
        <div
          className="invisible absolute left-full z-50 ml-2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 opacity-0 shadow-xl transition-all duration-200 group-hover:visible group-hover:opacity-100"
        >
          {label}
        </div>
      )}

      {isActive && !collapsed && (
        <div className="absolute right-2 h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const { user } = useAuthStore();
  const { isOnline, pendingCount } = useSyncStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-dvh flex-col border-r border-slate-800/50 bg-slate-950/95 backdrop-blur-xl md:flex',
        'transition-[width] duration-300 ease-in-out',
        sidebarCollapsed ? 'w-20' : 'w-72'
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/50 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-md ring-1 ring-slate-700/50">
            <img
              src={BRAND_LOGO_URL}
              alt=""
              className="h-full w-full object-cover"
              width={40}
              height={40}
              decoding="async"
            />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-100">SERVIPARTZ POS</h1>
              <p className="text-xs text-slate-500">Punto de venta</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/50 transition-colors hover:bg-slate-700/50"
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-slate-400" />
          )}
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain p-3">
        {MAIN_NAV_ITEMS.map(
          (item) =>
            hasPermission(item.permission) && (
              <NavItem
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                collapsed={sidebarCollapsed}
              />
            )
        )}
      </nav>

      <div className="shrink-0 border-t border-slate-800/50 p-4">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
            isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
          )}
        >
          {isOnline ? (
            <>
              <Cloud className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>En línea</span>}
            </>
          ) : (
            <>
              <CloudOff className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>Sin conexión</span>}
            </>
          )}
        </div>

        {pendingCount > 0 && !sidebarCollapsed && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-cyan-500/10 px-3 py-2 text-xs text-cyan-400">
            <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            <span>
              {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
            </span>
          </div>
        )}

        {!sidebarCollapsed && user && (
          <div className="mt-3 border-t border-slate-800/50 pt-3">
            <p className="text-xs text-slate-500">Usuario</p>
            <p className="truncate text-sm font-medium text-slate-300">{user.name}</p>
            <p className="text-xs capitalize text-slate-500">{user.role}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
