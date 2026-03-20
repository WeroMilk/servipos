// Sidebar Component
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  FileText, 
  Receipt, 
  Users, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff
} from 'lucide-react';
import { useAppStore, useAuthStore, useSyncStore } from '@/stores';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon: Icon, label, collapsed }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative',
        'hover:bg-slate-800/50 hover:shadow-lg hover:shadow-cyan-500/10',
        isActive 
          ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 border border-cyan-500/30 shadow-lg shadow-cyan-500/20' 
          : 'text-slate-400 hover:text-slate-100'
      )}
    >
      <Icon className={cn(
        'w-5 h-5 transition-all duration-200',
        isActive ? 'text-cyan-400' : 'group-hover:text-cyan-300'
      )} />
      
      {!collapsed && (
        <span className="hidden font-medium text-sm md:inline">{label}</span>
      )}
      
      {/* Tooltip cuando está colapsado */}
      {collapsed && (
        <div className="absolute left-full ml-2 px-3 py-1.5 bg-slate-800 text-slate-100 text-sm rounded-lg 
                        opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200
                        whitespace-nowrap z-50 border border-slate-700 shadow-xl">
          {label}
        </div>
      )}
      
      {/* Indicador activo */}
      {isActive && !collapsed && (
        <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const { user } = useAuthStore();
  const { isOnline, pendingCount } = useSyncStore();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Panel', permission: 'ventas:ver' },
    { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta', permission: 'ventas:crear' },
    { to: '/inventario', icon: Package, label: 'Inventario', permission: 'inventario:ver' },
    { to: '/cotizaciones', icon: FileText, label: 'Cotizaciones', permission: 'cotizaciones:ver' },
    { to: '/facturas', icon: Receipt, label: 'Facturación', permission: 'facturas:ver' },
    { to: '/clientes', icon: Users, label: 'Clientes', permission: 'ventas:ver' },
    { to: '/configuracion', icon: Settings, label: 'Configuración', permission: 'configuracion:ver' },
  ];

  const hasPermission = useAuthStore(state => state.hasPermission);

  return (
    <aside 
      className={cn(
        'fixed left-0 top-0 z-40 h-dvh border-r border-slate-800/50 bg-slate-950/95 backdrop-blur-xl',
        'transition-all duration-300 ease-in-out',
        sidebarCollapsed ? 'w-20' : 'w-72 max-md:w-20'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
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
            <div className="hidden min-w-0 md:block">
              <h1 className="text-sm font-bold text-slate-100">SERVIPARTZ POS</h1>
              <p className="text-xs text-slate-500">Punto de venta</p>
            </div>
          )}
        </div>
        
        {/* Toggle Button */}
        <button
          onClick={toggleSidebar}
          className="w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 
                     flex items-center justify-center transition-colors"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="p-3 space-y-1">
        {navItems.map(item => (
          hasPermission(item.permission as any) && (
            <NavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              collapsed={sidebarCollapsed}
            />
          )
        ))}
      </nav>

      {/* Status Footer */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800/50">
        {/* Connection Status */}
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
          isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
        )}>
          {isOnline ? (
            <>
              <Cloud className="w-4 h-4" />
              {!sidebarCollapsed && <span>En línea</span>}
            </>
          ) : (
            <>
              <CloudOff className="w-4 h-4" />
              {!sidebarCollapsed && <span>Sin conexión</span>}
            </>
          )}
        </div>

        {/* Pending Sync */}
        {pendingCount > 0 && !sidebarCollapsed && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs 
                          bg-cyan-500/10 text-cyan-400">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>{pendingCount} pendiente{pendingCount > 1 ? 's' : ''}</span>
          </div>
        )}

        {/* User Info */}
        {!sidebarCollapsed && user && (
          <div className="mt-3 hidden border-t border-slate-800/50 pt-3 md:block">
            <p className="text-xs text-slate-500">Usuario</p>
            <p className="truncate text-sm font-medium text-slate-300">{user.name}</p>
            <p className="text-xs capitalize text-slate-500">{user.role}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
