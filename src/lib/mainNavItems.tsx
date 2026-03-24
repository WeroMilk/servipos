import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  Receipt,
  Users,
  Settings,
  Clock,
} from 'lucide-react';
import type { Permission } from '@/types';

export interface MainNavItem {
  to: string;
  icon: LucideIcon;
  /** Etiqueta en sidebar expandido */
  label: string;
  /** Etiqueta en barra inferior móvil */
  shortLabel: string;
  permission: Permission;
}

export const MAIN_NAV_ITEMS: MainNavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Panel', shortLabel: 'Inicio', permission: 'ventas:ver' },
  {
    to: '/pos',
    icon: ShoppingCart,
    label: 'Punto de Venta',
    shortLabel: 'Ventas',
    permission: 'ventas:crear',
  },
  {
    to: '/inventario',
    icon: Package,
    label: 'Inventario',
    shortLabel: 'Stock',
    permission: 'inventario:ver',
  },
  {
    to: '/cotizaciones',
    icon: FileText,
    label: 'Cotizaciones',
    shortLabel: 'Cotiz.',
    permission: 'cotizaciones:ver',
  },
  // Visibilidad en sidebar/móvil: `SHOW_CHECADOR_NAV` en `@/lib/featureFlags`.
  {
    to: '/checador',
    icon: Clock,
    label: 'Checador',
    shortLabel: 'Chec.',
    permission: 'checador:registrar',
  },
  { to: '/facturas', icon: Receipt, label: 'Facturación', shortLabel: 'Fact.', permission: 'facturas:ver' },
  { to: '/clientes', icon: Users, label: 'Clientes', shortLabel: 'Cli.', permission: 'ventas:ver' },
  {
    to: '/configuracion',
    icon: Settings,
    label: 'Configuración',
    shortLabel: 'Ajust.',
    permission: 'configuracion:ver',
  },
];
