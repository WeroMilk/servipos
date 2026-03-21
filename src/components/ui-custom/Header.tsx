import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, User, Zap } from 'lucide-react';
import { useAuthStore, useSyncStore } from '@/stores';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { reportAppEvent } from '@/lib/appEventLog';
import { AdminSucursalSwitcher } from '@/components/ui-custom/AdminSucursalSwitcher';
import { AppEventsNotificationPanel } from '@/components/ui-custom/AppEventsNotificationPanel';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const prevPathRef = useRef<string | null>(null);
  const { user, logout } = useAuthStore();
  const { isOnline, isSyncing, pendingCount, sync } = useSyncStore();

  useEffect(() => {
    const path = location.pathname + location.search;
    if (prevPathRef.current === path) return;
    prevPathRef.current = path;
    reportAppEvent({
      kind: 'info',
      source: 'navegacion',
      title: `Vista: ${location.pathname}`,
      route: path,
    });
  }, [location.pathname, location.search]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header
      className={cn(
        'z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800/50',
        'bg-slate-950/60 px-2 backdrop-blur-md sm:h-16 sm:px-3 md:px-4 lg:px-4',
        'transition-all duration-300'
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3 md:gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-xl border border-transparent p-1 text-left transition-colors',
            'hover:border-slate-800/80 hover:bg-slate-800/40 sm:gap-3 sm:px-2 sm:py-1.5'
          )}
          aria-label="Ir al panel de inicio"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-slate-700/50">
            <img
              src={BRAND_LOGO_URL}
              alt=""
              className="h-full w-full object-cover"
              width={36}
              height={36}
              decoding="async"
            />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold tracking-tight text-slate-100 md:inline">
              <span className="md:hidden">SERVIPARTZ</span>
              <span className="hidden md:inline">SERVIPARTZ POS</span>
            </p>
            <p className="truncate text-[10px] text-slate-500 md:hidden">POS</p>
            <p className="hidden truncate text-xs text-slate-500 md:block">Panel · inicio</p>
          </div>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <AdminSucursalSwitcher />
        <button
          type="button"
          onClick={() => void sync()}
          disabled={!isOnline || isSyncing}
          className={cn(
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-200 sm:px-3',
            isSyncing
              ? 'bg-cyan-500/20 text-cyan-400'
              : pendingCount > 0
                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
          )}
        >
          <Zap className={cn('h-4 w-4', isSyncing && 'animate-pulse')} />
          <span className="hidden sm:inline">
            {isSyncing ? 'Sincronizando...' : pendingCount > 0 ? `${pendingCount} pendientes` : 'Sincronizado'}
          </span>
        </button>

        <AppEventsNotificationPanel />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 rounded-xl bg-slate-800/50 px-2 py-2 text-slate-100 hover:bg-slate-700/50 sm:gap-3 sm:px-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="hidden min-w-0 text-left sm:block">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs capitalize text-slate-500">{user?.role}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56 border-slate-800 bg-slate-900">
            <DropdownMenuLabel className="text-slate-100">Mi Cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-800" />

            <DropdownMenuItem
              className="cursor-pointer text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              onClick={() => navigate('/configuracion')}
            >
              <User className="mr-2 h-4 w-4" />
              Perfil
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-slate-800" />

            <DropdownMenuItem
              className="cursor-pointer text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => void handleLogout()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar Sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
