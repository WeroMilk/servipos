import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut,
  Map,
  Menu,
  Moon,
  Sun,
  User,
  Power,
  PowerOff,
  ClipboardList,
  ChevronDown,
  Wallet,
  Clock,
  Printer,
  Download,
  Plus,
  X,
} from 'lucide-react';
import { useAuthStore, useSyncStore, useAppStore, getResolvedIsDark } from '@/stores';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AdminSucursalSwitcher } from '@/components/ui-custom/AdminSucursalSwitcher';
import { AccentColorPicker } from '@/components/ui-custom/AccentColorPicker';
import { BRAND_LOGO_SRCSET, BRAND_LOGO_URL } from '@/lib/branding';
import { ROLE_LABELS, userCanSeeInventoryMissions, userCanSeeMissionProgressOnly } from '@/lib/userPermissions';
import { MAIN_NAV_ITEMS } from '@/lib/mainNavItems';
import { SHOW_CHECADOR_NAV } from '@/lib/featureFlags';
import { canAccessBuscaminasEasterEgg, isGabrielUser, registerLogoEasterEggClick } from '@/lib/gabrielEasterEgg';
import { useCajaPosHeaderStore } from '@/stores/cajaPosHeaderStore';
import { useVentasAbiertasPosHeaderStore } from '@/stores/ventasAbiertasPosHeaderStore';
import { useInventarioHeaderStore } from '@/stores/inventarioHeaderStore';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { CajaCierreReportesDialog, CajaCierreReportesHeaderButton, CajaCierreReportesIcon } from '@/components/caja/CajaCierreReportesDialog';

const CROQUIS_TIENDA_URL = '/croquis-tienda.png';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const cajaPosHeader = useCajaPosHeaderStore();
  const { modificarSaldoVisible, openModificarSaldo } = cajaPosHeader;
  const ventasAbiertasHeader = useVentasAbiertasPosHeaderStore();
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const resolvedDark = useAppStore((s) => getResolvedIsDark(s));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileCierreReportesOpen, setMobileCierreReportesOpen] = useState(false);
  const [croquisOpen, setCroquisOpen] = useState(false);
  const firstMobileNavItemRef = useRef<HTMLButtonElement | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const mobileCierreOpenTimerRef = useRef<number | null>(null);

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    if (!user) return;
    void useSyncStore.getState().updatePendingCount();
  }, [user?.id, effectiveSucursalId]);

  // Evita overlays "huérfanos" al navegar desde otros atajos móviles.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const id = window.setTimeout(() => {
      firstMobileNavItemRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(id);
  }, [mobileMenuOpen]);

  useEffect(() => {
    return () => {
      if (mobileCierreOpenTimerRef.current != null) {
        window.clearTimeout(mobileCierreOpenTimerRef.current);
      }
    };
  }, []);

  const openMobileCierreReportes = () => {
    if (mobileCierreOpenTimerRef.current != null) {
      window.clearTimeout(mobileCierreOpenTimerRef.current);
    }
    setMobileMenuOpen(false);
    // Panel fijo (sin Radix): se puede abrir en cuanto el Sheet empieza a cerrar.
    mobileCierreOpenTimerRef.current = window.setTimeout(() => {
      mobileCierreOpenTimerRef.current = null;
      setMobileCierreReportesOpen(true);
    }, 50);
  };

  const handleSheetTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartXRef.current = touch.clientX;
    swipeStartYRef.current = touch.clientY;
  };

  const handleSheetTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!mobileMenuOpen) return;
    const touch = event.touches[0];
    const startX = swipeStartXRef.current;
    const startY = swipeStartYRef.current;
    if (!touch || startX === null || startY === null) return;

    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) + 12;
    const closeThreshold = 72;
    if (isHorizontalSwipe && deltaX > closeThreshold) {
      setMobileMenuOpen(false);
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
    }
  };

  const handleSheetTouchEnd = () => {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
  };

  const showPosHeaderTools =
    location.pathname === '/pos' && hasPermission('ventas:crear');

  const invHeader = useInventarioHeaderStore();
  const showInventarioHeaderTools =
    location.pathname === '/inventario' &&
    hasPermission('inventario:ver') &&
    invHeader.registered;

  const inventarioToolbarButtons = showInventarioHeaderTools ? (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="Historial de movimientos de inventario"
        aria-label="Historial de movimientos de inventario"
        onClick={() => invHeader.onHistorial()}
        className="h-9 w-9 shrink-0 rounded-xl border-brand-to/45 text-brand-to hover:bg-brand/10 hover:text-brand-to dark:border-amber-500/45 dark:text-amber-200/95 dark:hover:bg-amber-500/15 dark:hover:text-amber-100 sm:h-9 sm:w-9"
      >
        <Clock className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="Imprimir ticket de stock bajo"
        aria-label="Ticket stock bajo"
        onClick={() => invHeader.onTicketStockBajo()}
        className="h-9 w-9 shrink-0 rounded-xl border-brand-to/45 text-brand-to hover:bg-brand/10 hover:text-brand-to dark:border-amber-500/45 dark:text-amber-200/95 dark:hover:bg-amber-500/15 dark:hover:text-amber-100 sm:h-9 sm:w-9"
      >
        <Printer className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title={invHeader.exportingInventario ? 'Generando archivo…' : 'Descargar inventario (CSV)'}
        aria-label={invHeader.exportingInventario ? 'Generando inventario' : 'Descargar inventario'}
        disabled={invHeader.descargarDisabled}
        onClick={() => void invHeader.onDescargar()}
        className="h-9 w-9 shrink-0 rounded-xl border-slate-300 dark:border-slate-600 sm:h-9 sm:w-9"
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        title="Nuevo producto"
        aria-label="Nuevo producto"
        onClick={() => invHeader.onNuevo()}
        className="h-9 w-9 shrink-0 rounded-xl bg-brand-gradient text-white hover:from-brand-from hover:to-brand-to sm:h-9 sm:w-9"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </>
  ) : null;

  const posToolbar = showPosHeaderTools ? (
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
          aria-label={cajaPosHeader.cajaAbierta ? 'Cerrar caja' : 'Abrir caja'}
          onClick={() => {
            cajaPosHeader.toggleCaja();
            closeMobileMenu();
          }}
          className={cn(
            'flex h-10 w-10 shrink-0 rounded-xl border-slate-300 dark:border-slate-600 sm:h-9 sm:w-9',
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
        <div className="relative shrink-0">
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
            onClick={() => {
              ventasAbiertasHeader.openVentasAbiertasDialog();
              closeMobileMenu();
            }}
            className="relative h-10 w-10 rounded-xl border-slate-300 dark:border-slate-600 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15 sm:h-9 sm:w-9"
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
      {cajaPosHeader.registered && modificarSaldoVisible ?
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              title="Modificar saldo de caja (ingreso o retiro de efectivo)"
              aria-label="Modificar saldo"
              aria-haspopup="menu"
              className="h-10 shrink-0 gap-1 rounded-xl border-slate-300 px-2.5 text-slate-700 hover:bg-brand/10 hover:text-brand-to dark:border-slate-600 dark:text-brand dark:hover:bg-brand/15 sm:h-9 sm:px-3"
            >
              <Wallet className="h-4 w-4 shrink-0" />
              <span className="hidden text-xs font-medium min-[400px]:inline">Modificar saldo</span>
              <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 opacity-70 min-[400px]:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuItem
              onClick={() => {
                openModificarSaldo('aporte');
                closeMobileMenu();
              }}
            >
              Agregar saldo
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                openModificarSaldo('retiro');
                closeMobileMenu();
              }}
            >
              Retirar saldo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      : null}
    </>
  ) : null;

  const hideProfileButton = user?.role === 'cashier' && isGabrielUser(user);

  const showCierreReportesButton = hasPermission('ventas:ver');

  const handleBrandLogoClick = (e: MouseEvent) => {
    if (!canAccessBuscaminasEasterEgg(user)) return;
    if (registerLogoEasterEggClick()) {
      e.preventDefault();
      navigate('/buscaminas');
    }
  };

  const mobileNavItems = MAIN_NAV_ITEMS.filter((item) => {
    if (item.to === '/checador' && !SHOW_CHECADOR_NAV) return false;
    if (item.to === '/mision-inventario') {
      return userCanSeeInventoryMissions(user) || userCanSeeMissionProgressOnly(user);
    }
    return hasPermission(item.permission);
  });

  return (
    <>
      <header
        className={cn(
          'z-30 flex h-14 min-w-0 shrink-0 items-center justify-between gap-1 border-b border-slate-200/80 dark:border-slate-800/50',
          'bg-white/70 px-1.5 backdrop-blur-md dark:bg-slate-950/60 sm:h-16 sm:gap-2 sm:px-3 md:gap-2 md:px-4 lg:px-4',
          'transition-all duration-300'
        )}
      >
        {/* Móvil / tablet: logo + menú */}
        <div className="flex w-full min-w-0 items-center gap-1 sm:gap-1.5 lg:hidden">
          <Link
            to="/"
            onClick={handleBrandLogoClick}
            className="flex shrink-0 items-center rounded-lg p-1 outline-none ring-brand/40 focus-visible:ring-2"
            aria-label="Ir a inicio"
          >
            <img
              src={BRAND_LOGO_URL}
              srcSet={BRAND_LOGO_SRCSET}
              sizes="32px"
              alt=""
              className="h-8 w-8 shrink-0 rounded-md object-cover scale-[1.06] [image-rendering:auto] [image-rendering:-webkit-optimize-contrast]"
              width={32}
              height={32}
              loading="eager"
            />
          </Link>
          {inventarioToolbarButtons ? (
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto px-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
              {inventarioToolbarButtons}
            </div>
          ) : (
            <div className="min-w-0 flex-1" aria-hidden />
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl border-slate-300 dark:border-slate-600"
            aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            <span className="relative block h-5 w-5">
              <Menu
                className={cn(
                  'absolute inset-0 h-5 w-5 transition-all duration-200 ease-out',
                  mobileMenuOpen ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
                )}
              />
              <X
                className={cn(
                  'absolute inset-0 h-5 w-5 transition-all duration-200 ease-out',
                  mobileMenuOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
                )}
              />
            </span>
          </Button>
        </div>

        {/* Escritorio */}
        <div className="hidden min-w-0 flex-1 items-center justify-between gap-2 lg:flex">
          <div className="flex shrink-0 items-center px-0.5">
            <Link
              to="/"
              onClick={handleBrandLogoClick}
              className="flex shrink-0 items-center rounded-lg p-1 outline-none ring-brand/40 focus-visible:ring-2 sm:hidden"
              aria-label="Ir a inicio"
            >
              <img
                src={BRAND_LOGO_URL}
                srcSet={BRAND_LOGO_SRCSET}
                sizes="32px"
                alt=""
                className="h-8 w-8 shrink-0 rounded-md object-cover scale-[1.06] [image-rendering:auto] [image-rendering:-webkit-optimize-contrast]"
                width={32}
                height={32}
                loading="eager"
              />
            </Link>
            <p className="hidden text-xs font-semibold tracking-[0.18em] text-slate-500 xl:block xl:text-sm">
              MENÚ
            </p>
            {showPosHeaderTools ? (
              <div className="ml-1 flex items-center gap-1 md:gap-1">{posToolbar}</div>
            ) : null}
            {inventarioToolbarButtons ? (
              <div className="ml-1 flex min-w-0 items-center gap-0.5 md:gap-1">
                {inventarioToolbarButtons}
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2 md:gap-3">
            <AdminSucursalSwitcher />

            {showCierreReportesButton ? (
              <CajaCierreReportesHeaderButton
                sucursalId={effectiveSucursalId ?? null}
                className="h-10 w-10 rounded-xl"
              />
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl bg-slate-200/80 text-slate-700 hover:bg-slate-300/80 hover:text-slate-900 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              onClick={() => setCroquisOpen(true)}
              aria-label="Croquis de la tienda"
              title="Croquis de la tienda"
            >
              <Map className="h-5 w-5" />
            </Button>

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

            <AccentColorPicker />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-200/80 px-2 py-2 text-slate-900 hover:bg-slate-300/80 dark:bg-slate-800/50 dark:text-slate-100 dark:hover:bg-slate-700/50 sm:gap-3 sm:px-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-from to-brand-to">
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

                {!hideProfileButton ? (
                  <>
                    <DropdownMenuItem
                      className="cursor-pointer text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      onClick={() => navigate('/configuracion')}
                    >
                      <User className="mr-2 h-4 w-4" />
                      Perfil
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="bg-slate-200 dark:bg-slate-800" />
                  </>
                ) : null}

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
        </div>
      </header>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="right"
          showCloseButton
          onTouchStart={handleSheetTouchStart}
          onTouchMove={handleSheetTouchMove}
          onTouchEnd={handleSheetTouchEnd}
          className={cn(
            'flex h-dvh max-h-dvh flex-col gap-0 rounded-none rounded-l-2xl border-y-0 border-r-0 border-l border-slate-200 py-4 pl-4 pr-10 dark:border-slate-800 sm:pr-12',
            'max-h-[100dvh] overflow-hidden'
          )}
        >
          <SheetHeader className="shrink-0 space-y-2 border-b border-slate-200/80 pb-3 pr-2 text-left dark:border-slate-800/80">
            <SheetTitle className="text-base text-slate-900 dark:text-slate-100">Menú</SheetTitle>
            <SheetDescription className="sr-only">
              Menú móvil con navegación y accesos de la cuenta.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain py-4 pr-2">
            {user ? (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5 dark:border-slate-800/60 dark:bg-slate-900/50">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.name}
                </p>
                <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                  {user.role ? ROLE_LABELS[user.role] : ''}
                </p>
              </div>
            ) : null}

            <div className="min-w-0">
              <AdminSucursalSwitcher />
            </div>

            {showCierreReportesButton ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-slate-800/60 dark:bg-slate-900/50">
                <span className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  Cierres de caja
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 border-slate-300 bg-white text-brand hover:bg-slate-100 hover:text-brand-to dark:border-slate-600 dark:bg-slate-800/80 dark:text-brand dark:hover:bg-slate-800 dark:hover:text-brand"
                  aria-label="Reportes de cierre de caja"
                  title="Reportes de cierre de caja"
                  onClick={openMobileCierreReportes}
                >
                  <CajaCierreReportesIcon />
                </Button>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Navegación
              </p>
              <div className="grid grid-cols-1 gap-2">
                {mobileNavItems.map((item) => {
                  const Icon = item.icon;
                  const isFirstItem = item.to === mobileNavItems[0]?.to;
                  const isActive =
                    item.to === '/'
                      ? location.pathname === '/' || location.pathname === ''
                      : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                  const label =
                    item.to === '/mision-inventario' &&
                    userCanSeeMissionProgressOnly(user) &&
                    !userCanSeeInventoryMissions(user)
                      ? 'Progreso inventario'
                      : item.label;

                  return (
                    <Button
                      key={item.to}
                      ref={isFirstItem ? firstMobileNavItemRef : undefined}
                      type="button"
                      variant="outline"
                      className={cn(
                        'w-full justify-start rounded-xl border-slate-300 dark:border-slate-600',
                        isActive &&
                          'border-brand/45 bg-brand/10 text-brand-to dark:border-brand/45 dark:bg-brand/15 dark:text-brand'
                      )}
                      onClick={() => {
                        closeMobileMenu();
                        navigate(item.to);
                      }}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {showPosHeaderTools ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Punto de venta
                </p>
                <div className="flex flex-wrap gap-2">{posToolbar}</div>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl border-slate-300 dark:border-slate-600"
                onClick={() => {
                  closeMobileMenu();
                  setCroquisOpen(true);
                }}
                aria-label="Croquis de la tienda"
                title="Croquis de la tienda"
              >
                <Map className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl border-slate-300 dark:border-slate-600"
                onClick={() => {
                  toggleTheme();
                }}
              >
                {resolvedDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                {resolvedDark ? 'Modo claro' : 'Modo oscuro'}
              </Button>
              <AccentColorPicker className="rounded-xl border border-slate-300 dark:border-slate-600" />
            </div>

            <div className="mt-auto flex flex-col gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800/80">
              {!hideProfileButton ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start rounded-xl border-slate-300 dark:border-slate-600"
                  onClick={() => {
                    closeMobileMenu();
                    navigate('/configuracion');
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  Perfil
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start rounded-xl border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => void handleLogout()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {showCierreReportesButton ? (
        <CajaCierreReportesDialog
          open={mobileCierreReportesOpen}
          onOpenChange={setMobileCierreReportesOpen}
          sucursalId={effectiveSucursalId ?? null}
          presentation="fixed-panel"
        />
      ) : null}

      <Dialog open={croquisOpen} onOpenChange={setCroquisOpen}>
        <DialogContent
          closeOnOutsideClick
          useDialogDescription
          className="flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-2rem))] flex-col gap-3 overflow-hidden border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900 sm:max-w-[min(96vw,56rem)]"
        >
          <DialogHeader className="shrink-0 pr-8 text-left">
            <DialogTitle className="text-slate-900 dark:text-slate-100">
              Croquis de la tienda
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Acomodo físico de muebles. Toca fuera para cerrar.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg bg-white dark:bg-slate-950">
            <img
              src={CROQUIS_TIENDA_URL}
              alt="Croquis de la tienda con el acomodo de muebles"
              className="mx-auto h-auto max-h-[min(78dvh,calc(100dvh-10rem))] w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
