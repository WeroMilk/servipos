import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  ShoppingCart,
  Package,
  Receipt,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  CalendarDays,
  Printer,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSalesByDateRange, useLowStockProducts, useTodaySales } from '@/hooks';
import { cn, formatMoney } from '@/lib/utils';
import { printThermalTicketFromSale } from '@/lib/printTicket';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { DateRange } from 'react-day-picker';
import {
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { Sale } from '@/types';
import { DashboardPeriodPopover, type PeriodGranularity } from '@/components/ui-custom/DashboardPeriodPopover';

const salesData = [
  { name: 'Lun', ventas: 4500 },
  { name: 'Mar', ventas: 6200 },
  { name: 'Mié', ventas: 5100 },
  { name: 'Jue', ventas: 7800 },
  { name: 'Vie', ventas: 9200 },
  { name: 'Sáb', ventas: 11500 },
  { name: 'Dom', ventas: 8900 },
];

const barCursor = { fill: 'rgba(15, 23, 42, 0.92)' };

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  trend: 'up' | 'down' | 'neutral';
  trendValue: string;
  iconGradient: string;
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  trendValue,
  iconGradient,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'flex h-full min-h-[10.5rem] flex-col border-slate-800/50 bg-slate-900/50 backdrop-blur-sm',
        'transition-colors duration-200 hover:border-slate-700/50 sm:min-h-[11rem]'
      )}
    >
      <CardContent className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-h-[2.5rem] max-w-[calc(100%-2.75rem)] text-left text-xs font-medium leading-tight text-slate-400 sm:text-sm">
            {title}
          </h3>
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm sm:h-10 sm:w-10',
              iconGradient
            )}
          >
            <Icon className="h-4 w-4 text-white sm:h-5 sm:w-5" />
          </div>
        </div>

        <p className="mt-3 text-xl font-bold tabular-nums text-slate-100 sm:text-2xl">{value}</p>
        <p className="mt-1 min-h-[1.125rem] text-[10px] text-slate-500 sm:text-xs">{description}</p>

        <div className="mt-auto min-h-[1.35rem] pt-2">
          <div
            className={cn(
              'flex items-center gap-1 text-[10px] sm:text-xs',
              trend === 'up'
                ? 'text-emerald-400'
                : trend === 'down'
                  ? 'text-red-400'
                  : 'text-slate-400'
            )}
          >
            {trend === 'up' ? (
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            ) : trend === 'down' ? (
              <ArrowDownRight className="h-3 w-3 shrink-0" />
            ) : null}
            <span className="leading-tight">{trendValue}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function dateRangeToBounds(range: DateRange | undefined): { inicio: Date; fin: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!range?.from) {
    const fin = new Date(today);
    fin.setDate(fin.getDate() + 1);
    return { inicio: today, fin };
  }
  const inicio = new Date(range.from);
  inicio.setHours(0, 0, 0, 0);
  const last = range.to ?? range.from;
  const fin = new Date(last);
  fin.setHours(0, 0, 0, 0);
  fin.setDate(fin.getDate() + 1);
  return { inicio, fin };
}

export function Dashboard() {
  const navigate = useNavigate();
  const [dateOpen, setDateOpen] = useState(false);
  const [periodGranularity, setPeriodGranularity] = useState<PeriodGranularity>('day');
  const [todaySalesOpen, setTodaySalesOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return { from: t, to: t };
  });

  const { inicio, fin } = useMemo(() => dateRangeToBounds(dateRange), [dateRange]);
  const { sales, loading: salesLoading, totals } = useSalesByDateRange(inicio, fin);
  const { products: lowStockProducts, loading: stockLoading } = useLowStockProducts();
  const { sales: salesToday, loading: todaySalesLoading } = useTodaySales();

  const salesTodaySorted = useMemo(
    () =>
      [...salesToday].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [salesToday]
  );

  const goInventarioStock = () => navigate('/inventario?tab=stock');

  const openTodaySalesDialog = () => setTodaySalesOpen(true);

  const stockCardKeyHandler = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goInventarioStock();
    }
  };

  const recentSalesCardKeyHandler = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTodaySalesDialog();
    }
  };

  const rangeLabel = useMemo(() => {
    if (!dateRange?.from) return 'Hoy';
    const a = dateRange.from;
    const b = dateRange.to ?? dateRange.from;
    if (a.getTime() === b.getTime()) {
      return format(a, "EEE d MMM yyyy", { locale: es });
    }
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return `${format(a, 'd', { locale: es })} – ${format(b, "d MMM yyyy", { locale: es })}`;
    }
    return `${format(a, 'd MMM', { locale: es })} – ${format(b, 'd MMM yyyy', { locale: es })}`;
  }, [dateRange]);

  const setHoy = () => {
    setPeriodGranularity('day');
    const t = startOfDay(new Date());
    setDateRange({ from: t, to: t });
    setDateOpen(true);
  };

  const setEsteMes = () => {
    setPeriodGranularity('month');
    const now = new Date();
    setDateRange({
      from: startOfMonth(now),
      to: endOfMonth(now),
    });
    setDateOpen(true);
  };

  const setMesAnterior = () => {
    setPeriodGranularity('month');
    const now = new Date();
    const first = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    setDateRange({
      from: first,
      to: endOfMonth(first),
    });
    setDateOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden sm:gap-3">
      <header className="flex shrink-0 flex-col gap-2 border-b border-slate-800/40 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-100 sm:text-xl lg:text-2xl">Panel</h1>
          <p className="truncate text-xs text-slate-500 sm:text-sm">Resumen del periodo</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
            onClick={setHoy}
          >
            Hoy
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
            onClick={setEsteMes}
          >
            Este mes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
            onClick={setMesAnterior}
          >
            Mes anterior
          </Button>
          <DashboardPeriodPopover
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            open={dateOpen}
            onOpenChange={setDateOpen}
            granularity={periodGranularity}
            onGranularityChange={setPeriodGranularity}
            rangeLabel={rangeLabel}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#1a73e8]/50 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
              >
                <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-[#8ab4f8]" />
                <span className="max-w-[10rem] truncate sm:max-w-none">{rangeLabel}</span>
              </Button>
            }
          />
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <StatCard
          title="Ventas periodo"
          value={formatMoney(totals.total)}
          description={`${totals.count} transacciones`}
          icon={DollarSign}
          trend="up"
          trendValue="Rango seleccionado"
          iconGradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
        />
        <StatCard
          title="Ticket prom."
          value={formatMoney(totals.count > 0 ? totals.total / totals.count : 0)}
          description="Por transacción"
          icon={ShoppingCart}
          trend="neutral"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-cyan-500 to-cyan-600"
        />
        <StatCard
          title="Unidades"
          value={sales
            .reduce((sum, sale) => sum + (sale.productos?.length ?? 0), 0)
            .toString()}
          description="Líneas vendidas"
          icon={Package}
          trend="neutral"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-blue-500 to-blue-600"
        />
        <StatCard
          title="Facturas"
          value={sales.filter((s) => s.facturaId).length.toString()}
          description="Del total ventas"
          icon={Receipt}
          trend="up"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-violet-500 to-violet-600"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden lg:flex-row lg:gap-3">
        <div className="flex min-h-0 min-w-0 flex-[1.4] flex-col gap-2 overflow-hidden lg:min-h-0">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 py-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                <TrendingUp className="h-4 w-4 shrink-0 text-cyan-400" />
                Ventas de la semana (referencia)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-2 pt-0 sm:p-3">
              <div className="min-h-[140px] flex-1 sm:min-h-[160px] lg:min-h-[11rem]">
                <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                  <BarChart data={salesData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #1e293b',
                        borderRadius: '8px',
                        color: '#f1f5f9',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [formatMoney(value), 'Ventas']}
                      cursor={barCursor}
                    />
                    <Bar
                      dataKey="ventas"
                      fill="url(#colorGradient)"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                      activeBar={{ fill: 'url(#colorGradient)', fillOpacity: 0.95 }}
                    />
                    <defs>
                      <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.85} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.25} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2 lg:grid-cols-2 lg:gap-3">
            <Card
              role="button"
              tabIndex={0}
              onClick={goInventarioStock}
              onKeyDown={stockCardKeyHandler}
              className={cn(
                'flex min-h-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50',
                'cursor-pointer transition-colors hover:border-amber-500/35 hover:bg-slate-900/70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40'
              )}
            >
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center justify-between gap-2 text-xs text-slate-100 sm:text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    Stock bajo
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 pt-0">
                {stockLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-800/50" />
                    ))}
                  </div>
                ) : lowStockProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-slate-500">
                    <Package className="mb-2 h-8 w-8 text-slate-600" />
                    <p className="text-xs">Sin alertas</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {lowStockProducts.slice(0, 8).map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/30 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-200">{product.nombre}</p>
                          <p className="text-[10px] text-slate-500">{product.sku}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={cn(
                              'text-xs font-bold',
                              product.existencia === 0 ? 'text-red-400' : 'text-amber-400'
                            )}
                          >
                            {product.existencia}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 border-t border-slate-800/60 pt-2 text-center text-[10px] text-slate-500 md:hidden">
                  Toca para abrir inventario · vista stock
                </p>
              </CardContent>
            </Card>

            <Card
              role="button"
              tabIndex={0}
              onClick={openTodaySalesDialog}
              onKeyDown={recentSalesCardKeyHandler}
              className={cn(
                'flex min-h-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50',
                'cursor-pointer transition-colors hover:border-cyan-500/35 hover:bg-slate-900/70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40'
              )}
            >
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center justify-between gap-2 text-xs text-slate-100 sm:text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <ShoppingCart className="h-4 w-4 shrink-0 text-cyan-400" />
                    Ventas recientes
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 pt-0">
                {salesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-800/50" />
                    ))}
                  </div>
                ) : sales.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-slate-500">
                    <Receipt className="mb-2 h-8 w-8 text-slate-600" />
                    <p className="text-xs">Sin ventas en el periodo</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {sales.slice(0, 8).map((sale) => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/30 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-200">{sale.folio}</p>
                          <p className="text-[10px] text-slate-500">
                            {new Date(sale.createdAt).toLocaleTimeString('es-MX', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs font-bold tabular-nums text-cyan-400">
                          {formatMoney(sale.total)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 border-t border-slate-800/60 pt-2 text-center text-[10px] text-slate-500 md:hidden">
                  Toca para ver ventas de hoy y reimprimir
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={todaySalesOpen} onOpenChange={setTodaySalesOpen}>
        <DialogContent className="flex max-h-[min(88dvh,36rem)] flex-col gap-0 overflow-hidden border-slate-800 bg-slate-900 p-0 text-slate-100 sm:max-w-md">
          <DialogHeader className="shrink-0 border-b border-slate-800/80 px-4 pb-3 pt-4 pr-12 text-left">
            <DialogTitle>Ventas de hoy</DialogTitle>
            <p className="text-sm font-normal text-slate-500">
              Lista del día para revisar o reimprimir el ticket.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {todaySalesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />
                ))}
              </div>
            ) : salesTodaySorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                <Receipt className="mb-2 h-10 w-10 text-slate-600" />
                <p className="text-sm">No hay ventas registradas hoy</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {salesTodaySorted.map((sale: Sale) => (
                  <li
                    key={sale.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-800/60 bg-slate-800/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{sale.folio}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(sale.createdAt).toLocaleString('es-MX', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {sale.estado === 'cancelada' ? (
                          <span className="ml-2 text-amber-400">· Cancelada</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-cyan-400">
                        {formatMoney(sale.total)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0 border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        printThermalTicketFromSale(sale);
                      }}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Reimprimir
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-800/80 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-slate-700 text-slate-300 sm:w-auto"
              onClick={() => setTodaySalesOpen(false)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
