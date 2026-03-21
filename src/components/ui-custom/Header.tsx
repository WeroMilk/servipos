import { Link, useNavigate } from 'react-router-dom';
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
import { AdminSucursalSwitcher } from '@/components/ui-custom/AdminSucursalSwitcher';
import { AppEventsNotificationPanel } from '@/components/ui-custom/AppEventsNotificationPanel';
import { BRAND_LOGO_URL } from '@/lib/branding';

export function Header() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isOnline, isSyncing, pendingCount, sync } = useSyncStore();

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
      <div className="flex min-w-0 items-center px-0.5">
        <Link
          to="/"
          className="flex min-w-0 max-w-[min(72vw,16rem)] items-center gap-2 rounded-lg py-1 pr-1 outline-none ring-cyan-500/40 focus-visible:ring-2 sm:hidden"
          aria-label="Ir a inicio"
        >
          <img
            src={BRAND_LOGO_URL}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain"
            width={32}
            height={32}
          />
          <span className="truncate text-sm font-semibold tracking-tight text-slate-100">SERVIPARTZ</span>
        </Link>
        <p className="hidden text-xs font-semibold tracking-[0.18em] text-slate-500 sm:block sm:text-sm">
          MENÚ
        </p>
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

        {user && user.role !== 'cashier' ? <AppEventsNotificationPanel /> : null}

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
