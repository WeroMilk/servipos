import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, User, Zap, X } from 'lucide-react';
import { useAuthStore, useSyncStore, useNotificationStore } from '@/stores';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';

type HeaderNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  /** Ruta al hacer clic (panel de notificaciones). */
  to: string;
};

const HEADER_NOTIFICATIONS: HeaderNotification[] = [
  {
    id: 'stock',
    title: 'Stock bajo',
    body: 'Revise productos por debajo del mínimo en Inventario.',
    time: 'Hoy',
    to: '/inventario?tab=stock',
  },
  {
    id: 'sync',
    title: 'Sincronización',
    body: 'Los datos locales se sincronizarán al estar en línea.',
    time: 'Hoy',
    to: '/configuracion',
  },
  {
    id: 'welcome',
    title: 'Bienvenido',
    body: 'SERVIPARTZ POS — panel listo para operar.',
    time: 'Reciente',
    to: '/',
  },
];

export function Header() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isOnline, isSyncing, pendingCount, sync } = useSyncStore();
  const { panelOpenedOnce, markPanelSeen } = useNotificationStore();
  const [notifOpen, setNotifOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const showUnreadDot = !panelOpenedOnce;

  return (
    <header
      className={cn(
        'z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800/50',
        'bg-slate-950/60 px-2 backdrop-blur-md sm:h-16 sm:px-3 md:px-4 lg:px-4',
        'transition-all duration-300'
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3 md:gap-4">
        <div className="flex min-w-0 items-center gap-2 md:hidden">
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
            <p className="truncate text-sm font-bold tracking-tight text-slate-100">SERVIPARTZ</p>
            <p className="truncate text-[10px] text-slate-500">POS</p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
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

        <Popover
          open={notifOpen}
          onOpenChange={(open) => {
            setNotifOpen(open);
            if (open) markPanelSeen();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-10 w-10 rounded-xl bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
              aria-label="Notificaciones"
            >
              <Bell className="h-5 w-5" />
              {showUnreadDot ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-slate-950" />
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className={cn(
              'w-[min(100vw-2rem,22rem)] border-slate-800 bg-slate-900 p-0 text-slate-100 shadow-xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out'
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
              <p className="text-sm font-semibold">Notificaciones</p>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                aria-label="Cerrar"
                onClick={() => setNotifOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="max-h-[min(60dvh,20rem)] overflow-y-auto overscroll-y-contain py-1">
              {HEADER_NOTIFICATIONS.map((n) => (
                <li key={n.id} className="border-b border-slate-800/60 last:border-0">
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-slate-800/40"
                    onClick={() => {
                      navigate(n.to);
                      setNotifOpen(false);
                    }}
                  >
                    <p className="text-xs font-medium text-slate-200">{n.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{n.body}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-600">{n.time}</p>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

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
