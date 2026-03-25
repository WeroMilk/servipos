import { useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Moon, Sun, User, Zap, Power, PowerOff, ClipboardList } from 'lucide-react';
import { useAuthStore, useSyncStore, useAppStore, getResolvedIsDark } from '@/stores';
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
import { ROLE_LABELS } from '@/lib/userPermissions';
import { useCajaPosHeaderStore } from '@/stores/cajaPosHeaderStore';
import { useVentasAbiertasPosHeaderStore } from '@/stores/ventasAbiertasPosHeaderStore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const cajaPosHeader = useCajaPosHeaderStore();
  const ventasAbiertasHeader = useVentasAbiertasPosHeaderStore();
  const { isOnline, isSyncing, pendingCount, sync } = useSyncStore();
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const resolvedDark = useAppStore((s) => getResolvedIsDark(s));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const enModoNube = Boolean(effectiveSucursalId);

  useEffect(() => {
    if (!user) return;
    void useSyncStore.getState().updatePendingCount();
  }, [user?.id, effectiveSucursalId]);

  return (
    <header
      className={cn(
        'z-30 flex h-14 min-w-0 shrink-0 items-center justify-between gap-1 border-b border-slate-200/80 dark:border-slate-800/50',
        'bg-white/70 px-1.5 backdrop-blur-md dark:bg-slate-950/60 sm:h-16 sm:gap-2 sm:px-3 md:gap-2 md:px-4 lg:px-4',
        'transition-all duration-300'
      )}
    >
      <div className="flex shrink-0 items-center px-0.5">
        <Link
          to="/"
          className="flex shrink-0 items-center rounded-lg p-1 outline-none ring-cyan-500/40 focus-visible:ring-2 sm:hidden"
          aria-label="Ir a inicio"
        >
          <img
            src={BRAND_LOGO_URL}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain"
            width={32}
            height={32}
          />
        </Link>
        <p className="hidden text-xs font-semibold tracking-[0.18em] text-slate-500 xl:block xl:text-sm">
          MENÚ
        </p>
        {location.pathname === '/pos' && hasPermission('ventas:crear') ? (
          <>
            {cajaPosHeader.registered ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={cajaPosHeader.loading}
                title={
                  cajaPosHeader.loading
                    ? 'Sincronizando caja…'
                    : cajaPosHeader.cajaAbierta
                      ? 'Cerrar caja (arqueo final)'
                      : 'Abrir caja'
                }
                aria-label={
                  cajaPosHeader.cajaAbierta ? 'Cerrar caja' : 'Abrir caja'
                }
                onClick={() => cajaPosHeader.toggleCaja()}
                className={cn(
                  'ml-1 flex h-9 w-9 shrink-0 rounded-xl border-slate-300 dark:border-slate-600',
                  cajaPosHeader.cajaAbierta
                    ? 'border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:border-emerald-500/45 dark:text-emerald-300'
                    : 'text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800'
                )}
              >
                {cajaPosHeader.cajaAbierta ? (
                  <PowerOff className="h-4 w-4" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
              </Button>
            ) : null}
            {ventasAbiertasHeader.registered ? (
              <div className="relative ml-1 shrink-0 md:ml-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Ventas abiertas (pendiente de pago)"
                  aria-label={
                    ventasAbiertasHeader.count > 0
                      ? `Ventas abiertas: ${ventasAbiertasHeader.count}`
                      : 'Ventas abiertas'
                  }
                  onClick={() => ventasAbiertasHeader.openVentasAbiertasDialog()}
                  className="relative h-9 w-9 rounded-xl border-slate-300 dark:border-slate-600 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
                >
                  <ClipboardList className="h-4 w-4" />
                </Button>
                {ventasAbiertasHeader.count > 0 ? (
                  <span
                    className={cn(
                      'pointer-events-none absolute -right-1 -top-1 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-white dark:ring-slate-950',
                      'bg-amber-500 dark:bg-amber-600'
                    )}
                    aria-hidden
                  >
                    {ventasAbiertasHeader.count > 99 ? '99+' : ventasAbiertasHeader.count}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2 md:gap-3">
        <AdminSucursalSwitcher />
        <button
          type="button"
          onClick={() => void sync()}
          disabled={!isOnline || isSyncing}
          title={
            isSyncing
              ? 'Actualizando contador…'
              : enModoNube
                ? 'Tienda en la nube (Firestore): inventario y ventas se leen y guardan en Firebase. El contador de «pendientes» de IndexedDB no aplica en este modo. Pulse para comprobar conexión.'
                : pendingCount > 0
                  ? `${pendingCount} fila(s) en IndexedDB con sync «pendiente» (modo solo local). Pulse para recalcular.`
                  : 'Ningún pendiente en la cola local. Pulse para comprobar de nuevo.'
          }
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 sm:px-3',
            isSyncing
              ? 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
              : pendingCount > 0
                ? 'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/30'
                : 'bg-slate-200/80 text-slate-600 hover:bg-slate-300/80 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-700/50'
          )}
        >
          <Zap className={cn('h-4 w-4', isSyncing && 'animate-pulse')} />
          <span className="hidden sm:inline">
            {isSyncing ? 'Comprobando…' : pendingCount > 0 ? `${pendingCount} pendientes` : 'Sincronizado'}
          </span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl bg-slate-200/80 text-slate-700 hover:bg-slate-300/80 hover:text-slate-900 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
          onClick={() => toggleTheme()}
          aria-label={resolvedDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {resolvedDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {user && hasPermission('reportes:ver') ? <AppEventsNotificationPanel dock="header" /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-200/80 px-2 py-2 text-slate-900 hover:bg-slate-300/80 dark:bg-slate-800/50 dark:text-slate-100 dark:hover:bg-slate-700/50 sm:gap-3 sm:px-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="hidden min-w-0 text-left sm:block">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {user?.role ? ROLE_LABELS[user.role] : ''}
                </p>
              </div>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <DropdownMenuLabel className="text-slate-900 dark:text-slate-100">Mi Cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-200 dark:bg-slate-800" />

            <DropdownMenuItem
              className="cursor-pointer text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              onClick={() => navigate('/configuracion')}
            >
              <User className="mr-2 h-4 w-4" />
              Perfil
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-slate-200 dark:bg-slate-800" />

            <DropdownMenuItem
              className="cursor-pointer text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
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
