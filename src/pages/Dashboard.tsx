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
import {
  useSalesByDateRange,
  useLowStockProducts,
  useTodaySales,
  useEffectiveSucursalId,
  useOutgoingPendingTransferIds,
} from '@/hooks';
import { cn, formatMoney } from '@/lib/utils';
import { printThermalDailySalesReport, printThermalTicketFromSale } from '@/lib/printTicket';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { DateRange } from 'react-day-picker';
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { getMexicoDateKey, startOfDayFromDateKey } from '@/lib/quincenaMx';
import { formatInAppTimezone } from '@/lib/appTimezone';
import type { Sale } from '@/types';
import { DashboardPeriodPopover, type PeriodGranularity } from '@/components/ui-custom/DashboardPeriodPopover';

const barCursor = { fill: 'rgba(15, 23, 42, 0.92)' };

const WEEKDAY_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

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
        'flex h-full min-h-[10.5rem] flex-col border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 backdrop-blur-sm',
        'transition-colors duration-200 hover:border-slate-300/80 dark:border-slate-700/50 sm:min-h-[11rem]'
      )}
    >
      <CardContent className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-h-[2.5rem] max-w-[calc(100%-2.75rem)] text-left text-xs font-medium leading-tight text-slate-600 dark:text-slate-400 sm:text-sm">
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

        <p className="mt-3 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-2xl">{value}</p>
        <p className="mt-1 min-h-[1.125rem] text-[10px] text-slate-600 dark:text-slate-500 sm:text-xs">{description}</p>

        <div className="mt-auto min-h-[1.35rem] pt-2">
          <div
            className={cn(
              'flex items-center gap-1 text-[10px] sm:text-xs',
              trend === 'up'
                ? 'text-emerald-400'
                : trend === 'down'
                  ? 'text-red-400'
                  : 'text-slate-600 dark:text-slate-400'
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
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [dateOpen, setDateOpen] = useState(false);
  const [periodGranularity, setPeriodGranularity] = useState<PeriodGranularity>('day');
  const [todaySalesOpen, setTodaySalesOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const t = startOfDayFromDateKey(getMexicoDateKey());
    return { from: t, to: t };
  });

  const { inicio, fin } = useMemo(() => dateRangeToBounds(dateRange), [dateRange]);

  /** Semana calendario (lun–dom) que contiene el día ancla del selector; el gráfico siempre muestra esos 7 días. */
  const chartWeekBounds = useMemo(() => {
    const anchor = startOfDay(dateRange?.from ?? startOfDayFromDateKey(getMexicoDateKey()));
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
    const weekEndExclusive = addDays(endOfWeek(anchor, { weekStartsOn: 1 }), 1);
    return { weekStart, weekEndExclusive };
  }, [dateRange?.from]);

  /** Una sola suscripción: cubre el periodo elegido y la semana del gráfico (p. ej. un solo día sigue trayendo lun–dom). */
  const fetchBounds = useMemo(() => {
    const { weekStart, weekEndExclusive } = chartWeekBounds;
    const fetchStart = new Date(Math.min(inicio.getTime(), weekStart.getTime()));
    const fetchEnd = new Date(Math.max(fin.getTime(), weekEndExclusive.getTime()));
    return { fetchStart, fetchEnd };
  }, [inicio, fin, chartWeekBounds]);

  const { sales: salesFetched, loading: salesLoading } = useSalesByDateRange(
    fetchBounds.fetchStart,
    fetchBounds.fetchEnd
  );

  const kpiSales = useMemo(() => {
    const i0 = inicio.getTime();
    const f0 = fin.getTime();
    return salesFetched.filter((s) => {
      const t = s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt);
      const x = t.getTime();
      return x >= i0 && x < f0;
    });
  }, [salesFetched, inicio, fin]);

  const totals = useMemo(() => {
    const total = kpiSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    return { total, count: kpiSales.length };
  }, [kpiSales]);
  const { products: lowStockProducts, loading: stockLoading } = useLowStockProducts();
  const { sales: salesToday, loading: todaySalesLoading } = useTodaySales();
  const outgoingTransferPendingIds = useOutgoingPendingTransferIds();

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
    if (!dateRange?.from) return 'fecha —';
    const from = startOfDay(dateRange.from);
    const to = startOfDay(dateRange.to ?? dateRange.from);

    if (periodGranularity === 'day') {
      return `fecha ${format(from, 'd MMM yyyy', { locale: es })}`;
    }
    if (periodGranularity === 'week') {
      return `${format(from, 'dd/MM/yy')} - ${format(to, 'dd/MM/yy')}`;
    }
    const m = format(from, 'MMMM', { locale: es });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }, [dateRange, periodGranularity]);

  /** Siempre 7 barras: lunes → domingo de la semana del día ancla; días sin ventas = 0. */
  const chartData = useMemo(() => {
    const { weekStart, weekEndExclusive } = chartWeekBounds;
    const weekEndInclusive = addDays(weekEndExclusive, -1);
    const days = eachDayOfInterval({ start: weekStart, end: weekEndInclusive });
    return days.map((d) => {
      const day0 = startOfDay(d);
      const next = addDays(day0, 1);
      const ventas = salesFetched.reduce((sum, sale) => {
        const t = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt);
        const x = t.getTime();
        if (x >= day0.getTime() && x < next.getTime()) {
          return sum + (Number(sale.total) || 0);
        }
        return sum;
      }, 0);
      const dowMon0 = (d.getDay() + 6) % 7;
      return {
        name: WEEKDAY_SHORT_ES[dowMon0]!,
        ventas,
        fullLabel: format(d, 'EEEE d MMM yyyy', { locale: es }),
      };
    });
  }, [salesFetched, chartWeekBounds]);

  const handleGranularityChange = (g: PeriodGranularity) => {
    setPeriodGranularity(g);
    setDateRange((prev) => {
      const anchor = startOfDay(prev?.from ?? startOfDayFromDateKey(getMexicoDateKey()));
      if (g === 'day') return { from: anchor, to: anchor };
      if (g === 'week') {
        return {
          from: startOfWeek(anchor, { weekStartsOn: 1 }),
          to: endOfWeek(anchor, { weekStartsOn: 1 }),
        };
      }
      return {
        from: startOfMonth(anchor),
        to: endOfMonth(anchor),
      };
    });
  };

  const setQuickDia = () => {
    setPeriodGranularity('day');
    const t = startOfDayFromDateKey(getMexicoDateKey());
    setDateRange({ from: t, to: t });
    setDateOpen(true);
  };

  const setQuickSemana = () => {
    setPeriodGranularity('week');
    const now = startOfDayFromDateKey(getMexicoDateKey());
    setDateRange({
      from: startOfWeek(now, { weekStartsOn: 1 }),
      to: endOfWeek(now, { weekStartsOn: 1 }),
    });
    setDateOpen(true);
  };

  const setQuickMes = () => {
    setPeriodGranularity('month');
    const now = startOfDayFromDateKey(getMexicoDateKey());
    setDateRange({
      from: startOfMonth(now),
      to: endOfMonth(now),
    });
    setDateOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden sm:gap-3">
      <header className="flex shrink-0 flex-col gap-2 border-b border-slate-200/80 dark:border-slate-800/40 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl lg:text-2xl">Panel</h1>
          <p className="truncate text-xs text-slate-600 dark:text-slate-500 sm:text-sm">Resumen del periodo</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/80 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            onClick={setQuickDia}
          >
            Día
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/80 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            onClick={setQuickSemana}
          >
            Semana
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/80 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            onClick={setQuickMes}
          >
            Mes
          </Button>
          <DashboardPeriodPopover
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            open={dateOpen}
            onOpenChange={setDateOpen}
            granularity={periodGranularity}
            onGranularityChange={handleGranularityChange}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#1a73e8]/50 bg-slate-100/90 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:bg-slate-800"
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
          value={kpiSales
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
          value={kpiSales.filter((s) => s.facturaId).length.toString()}
          description="Del total ventas"
          icon={Receipt}
          trend="up"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-violet-500 to-violet-600"
        />
      </div>

      <div className="hidden min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden md:flex md:flex-col lg:flex-row lg:gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden lg:min-h-0 lg:flex-[1.4]">
          <Card
            className={cn(
              'hidden min-h-[11rem] flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 lg:flex lg:min-h-0',
            )}
          >
            <CardHeader className="shrink-0 space-y-0 py-2">
              <CardTitle className="flex flex-col gap-0.5 text-sm text-slate-900 dark:text-slate-100 sm:text-base">
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 shrink-0 text-cyan-400" />
                  Ventas por día
                </span>
                <span className="text-[10px] font-normal text-slate-600 dark:text-slate-500 sm:text-xs">
                  Semana lun–dom (según fecha del selector)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-2 pt-0 sm:p-3">
              <div className="flex h-full min-h-[180px] w-full min-w-0 flex-1 flex-col">
                {salesLoading ? (
                  <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-slate-600 dark:text-slate-500">
                    Cargando ventas…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minHeight={180}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 4, left: 4, bottom: 36 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="name"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: '#334155' }}
                        interval={0}
                        tickMargin={8}
                        angle={-28}
                        textAnchor="end"
                        height={52}
                      />
                      <YAxis
                        width={48}
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
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.fullLabel != null
                            ? String(payload[0].payload.fullLabel)
                            : ''
                        }
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
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:grid sm:grid-cols-2 sm:gap-3 lg:gap-3">
            <Card
              role="button"
              tabIndex={0}
              onClick={goInventarioStock}
              onKeyDown={stockCardKeyHandler}
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 sm:flex-none',
                'cursor-pointer transition-colors hover:border-amber-500/35 hover:bg-slate-100 dark:bg-slate-900/70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40'
              )}
            >
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center justify-between gap-2 text-xs text-slate-900 dark:text-slate-100 sm:text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    Stock bajo
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-500" aria-hidden />
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 pt-0">
                {stockLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                    ))}
                  </div>
                ) : lowStockProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-slate-600 dark:text-slate-500">
                    <Package className="mb-2 h-8 w-8 text-slate-600" />
                    <p className="text-xs">Sin alertas</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {lowStockProducts.slice(0, 12).map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-200/60 dark:bg-slate-800/30 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{product.nombre}</p>
                          <p className="text-[10px] text-slate-600 dark:text-slate-500">{product.sku}</p>
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
                <p className="mt-2 border-t border-slate-200/80 dark:border-slate-800/60 pt-2 text-center text-[10px] text-slate-600 dark:text-slate-500 md:hidden">
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
                'flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 sm:flex-none',
                'cursor-pointer transition-colors hover:border-cyan-500/35 hover:bg-slate-100 dark:bg-slate-900/70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40'
              )}
            >
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center justify-between gap-2 text-xs text-slate-900 dark:text-slate-100 sm:text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <ShoppingCart className="h-4 w-4 shrink-0 text-cyan-400" />
                    Ventas recientes
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-500" aria-hidden />
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 pt-0">
                {salesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                    ))}
                  </div>
                ) : kpiSales.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-slate-600 dark:text-slate-500">
                    <Receipt className="mb-2 h-8 w-8 text-slate-600" />
                    <p className="text-xs">Sin ventas en el periodo</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {kpiSales.slice(0, 12).map((sale) => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-200/60 dark:bg-slate-800/30 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{sale.folio}</p>
                          <p className="text-[10px] text-slate-600 dark:text-slate-500">
                            {formatInAppTimezone(
                              sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt),
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                            {sale.formaPago === 'TTS' && outgoingTransferPendingIds.has(sale.id) ? (
                              <span className="ml-1.5 text-amber-400">· Traspaso pendiente</span>
                            ) : null}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs font-bold tabular-nums text-cyan-400">
                          {formatMoney(sale.total)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 border-t border-slate-200/80 dark:border-slate-800/60 pt-2 text-center text-[10px] text-slate-600 dark:text-slate-500 md:hidden">
                  Toca para ver ventas de hoy y reimprimir
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={todaySalesOpen} onOpenChange={setTodaySalesOpen}>
        <DialogContent className="flex max-h-[min(88dvh,36rem)] flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-0 border-b border-slate-200 dark:border-slate-800/80 px-4 pb-3 pt-4 pr-14 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <DialogTitle>Ventas de hoy</DialogTitle>
                <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                  Lista del día para revisar o reimprimir el ticket.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-cyan-400"
                title="Reporte de ventas diario (térmica)"
                aria-label="Imprimir reporte de ventas del día"
                disabled={salesTodaySorted.length === 0}
                onClick={() => {
                  printThermalDailySalesReport({
                    fechaLabel: formatInAppTimezone(new Date(), {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    }),
                    sucursalId: effectiveSucursalId,
                    ventas: salesTodaySorted,
                  });
                }}
              >
                <Printer className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {todaySalesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                ))}
              </div>
            ) : salesTodaySorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-600 dark:text-slate-500">
                <Receipt className="mb-2 h-10 w-10 text-slate-600" />
                <p className="text-sm">No hay ventas registradas hoy</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {salesTodaySorted.map((sale: Sale) => (
                  <li
                    key={sale.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800/60 bg-slate-200 dark:bg-slate-800/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{sale.folio}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">
                        {formatInAppTimezone(
                          sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt),
                          { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
                        )}
                        {sale.estado === 'cancelada' ? (
                          <span className="ml-2 text-amber-400">· Cancelada</span>
                        ) : null}
                        {sale.formaPago === 'TTS' && outgoingTransferPendingIds.has(sale.id) ? (
                          <span className="ml-2 text-amber-400">· Traspaso pendiente recepción</span>
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
                      className="shrink-0 border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        void printThermalTicketFromSale(sale);
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
          <DialogFooter className="shrink-0 border-t border-slate-200 dark:border-slate-800/80 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 sm:w-auto"
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
