import { useCallback, useMemo, useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  FileQuestion,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useEffectiveSucursalId,
  useOutgoingPendingTransferIds,
} from '@/hooks';
import { cn, formatMoney } from '@/lib/utils';
import { printThermalDailySalesReport, printThermalTicketFromSale } from '@/lib/printTicket';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DateRange } from 'react-day-picker';
import {
  addDays,
  addMonths,
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
import { useAuthStore, useAppStore } from '@/stores';
import { cancelSale } from '@/db/database';
import { saleListaCancelacionEtiqueta } from '@/lib/saleCancelacion';
import { saleIsInvoiced } from '@/lib/saleInvoiced';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const LINE_STROKE = '#0891b2';
const LINE_DOT_FILL = '#06b6d4';
const LINE_DOT_STROKE = '#164e63';

const WEEKDAY_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

function shortMonthLabelEs(d: Date): string {
  const raw = format(d, 'MMM', { locale: es }).replace(/\.$/, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

type ChartTimeRange =
  | { mode: 'week'; weekStart: Date; weekEndExclusive: Date }
  | { mode: 'months'; months: Date[] };

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
        'flex h-full min-h-0 flex-col border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50 backdrop-blur-sm',
        'transition-colors duration-200 hover:border-slate-300/80 dark:border-slate-700/50',
        'max-md:min-h-0 md:min-h-[10.5rem] lg:min-h-[11rem]'
      )}
    >
      <CardContent className="flex flex-1 flex-col p-2.5 sm:p-4 md:p-3">
        <div className="flex items-start justify-between gap-1.5 sm:gap-2">
          <h3 className="line-clamp-2 max-w-[calc(100%-2.5rem)] text-left text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-400 max-md:min-h-0 sm:text-xs md:min-h-[2.5rem] md:text-sm">
            {title}
          </h3>
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm md:h-9 md:w-9 lg:h-10 lg:w-10',
              iconGradient
            )}
          >
            <Icon className="h-3.5 w-3.5 text-white md:h-4 md:w-4 lg:h-5 lg:w-5" />
          </div>
        </div>

        <p className="mt-1.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 max-md:leading-tight sm:mt-3 sm:text-2xl">
          {value}
        </p>
        <p className="mt-0.5 text-[9px] text-slate-600 dark:text-slate-500 max-md:leading-tight sm:mt-1 sm:min-h-[1.125rem] sm:text-xs">
          {description}
        </p>

        <div className="mt-auto min-h-0 pt-1 sm:min-h-[1.35rem] sm:pt-2">
          <div
            className={cn(
              'flex items-center gap-1 text-[9px] sm:text-xs',
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

/** Mueve una fecha YYYY-MM-DD (calendario app / México) ±N días. */
function shiftMexicoDateKey(dateKey: string, deltaDays: number): string {
  return getMexicoDateKey(addDays(startOfDayFromDateKey(dateKey), deltaDays));
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useAppStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [dateOpen, setDateOpen] = useState(false);
  const [periodGranularity, setPeriodGranularity] = useState<PeriodGranularity>('day');
  const [todaySalesOpen, setTodaySalesOpen] = useState(false);
  const [reprintDayKey, setReprintDayKey] = useState(() => getMexicoDateKey());
  const [saleCancelOpen, setSaleCancelOpen] = useState(false);
  const [saleToCancel, setSaleToCancel] = useState<Sale | null>(null);
  const [saleCancelBusy, setSaleCancelBusy] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const t = startOfDayFromDateKey(getMexicoDateKey());
    return { from: t, to: t };
  });

  const { inicio, fin } = useMemo(() => dateRangeToBounds(dateRange), [dateRange]);

  /** Rango que pinta el gráfico: 7 días (lun–dom) en día/semana, o 7 meses (±3) en modo mes. */
  const chartTimeRange = useMemo((): ChartTimeRange => {
    const anchor = startOfDay(dateRange?.from ?? startOfDayFromDateKey(getMexicoDateKey()));
    if (periodGranularity === 'month') {
      const centerMonth = startOfMonth(anchor);
      const months = Array.from({ length: 7 }, (_, i) => addMonths(centerMonth, i - 3));
      return { mode: 'months', months };
    }
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
    const weekEndExclusive = addDays(endOfWeek(weekStart, { weekStartsOn: 1 }), 1);
    return { mode: 'week', weekStart, weekEndExclusive };
  }, [periodGranularity, dateRange?.from]);

  /** Cubre el periodo KPI y el rango completo del gráfico (semana o 7 meses). */
  const fetchBounds = useMemo(() => {
    let chartStart: Date;
    let chartEndExclusive: Date;
    if (chartTimeRange.mode === 'months') {
      const first = chartTimeRange.months[0]!;
      const last = chartTimeRange.months[6]!;
      chartStart = startOfMonth(first);
      chartEndExclusive = addDays(endOfMonth(last), 1);
    } else {
      chartStart = chartTimeRange.weekStart;
      chartEndExclusive = chartTimeRange.weekEndExclusive;
    }
    const fetchStart = new Date(Math.min(inicio.getTime(), chartStart.getTime()));
    const fetchEnd = new Date(Math.max(fin.getTime(), chartEndExclusive.getTime()));
    return { fetchStart, fetchEnd };
  }, [inicio, fin, chartTimeRange]);

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

  const kpiVentasParaTotales = useMemo(
    () => kpiSales.filter((s) => s.estado !== 'cancelada' && s.estado !== 'pendiente'),
    [kpiSales]
  );

  const totals = useMemo(() => {
    const total = kpiVentasParaTotales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    return { total, count: kpiVentasParaTotales.length };
  }, [kpiVentasParaTotales]);
  const { products: lowStockProducts, loading: stockLoading } = useLowStockProducts();
  const outgoingTransferPendingIds = useOutgoingPendingTransferIds();

  const reprintDayStart = useMemo(() => startOfDayFromDateKey(reprintDayKey), [reprintDayKey]);
  const reprintDayEnd = useMemo(() => addDays(reprintDayStart, 1), [reprintDayStart]);
  const { sales: reprintSalesRaw, loading: reprintSalesLoading } = useSalesByDateRange(
    reprintDayStart,
    reprintDayEnd
  );
  const reprintSalesSorted = useMemo(
    () =>
      [...reprintSalesRaw].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [reprintSalesRaw]
  );
  const reprintTodayKey = getMexicoDateKey();
  const reprintCanGoNext = reprintDayKey < reprintTodayKey;

  const goInventarioStock = () => navigate('/inventario?tab=stock');

  const openTodaySalesDialog = () => setTodaySalesOpen(true);

  const confirmCancelSaleFromPanel = useCallback(async () => {
    if (!saleToCancel) return;
    setSaleCancelBusy(true);
    try {
      await cancelSale(saleToCancel.id, {
        motivo: 'Cancelación desde panel (administrador)',
        ...(effectiveSucursalId ? { sucursalId: effectiveSucursalId } : {}),
        cancelacionMotivo: 'panel',
      });
      addToast({
        type: 'success',
        message: 'Venta cancelada. Inventario restaurado; el importe ya no cuenta en totales.',
      });
      setSaleCancelOpen(false);
      setSaleToCancel(null);
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo cancelar la venta',
      });
    } finally {
      setSaleCancelBusy(false);
    }
  }, [saleToCancel, effectiveSucursalId, addToast]);

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

  /** 7 puntos: lun–dom (día/semana) o 7 meses consecutivos (modo mes). */
  const chartData = useMemo(() => {
    if (chartTimeRange.mode === 'months') {
      return chartTimeRange.months.map((m) => {
        const ms = startOfMonth(m);
        const me = addDays(endOfMonth(m), 1);
        const ventas = salesFetched.reduce((sum, sale) => {
          if (sale.estado === 'cancelada') return sum;
          const t = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt);
          const x = t.getTime();
          if (x >= ms.getTime() && x < me.getTime()) {
            return sum + (Number(sale.total) || 0);
          }
          return sum;
        }, 0);
        return {
          name: shortMonthLabelEs(m),
          ventas,
          fullLabel: format(m, 'MMMM yyyy', { locale: es }),
        };
      });
    }
    const { weekStart, weekEndExclusive } = chartTimeRange;
    const weekEndInclusive = addDays(weekEndExclusive, -1);
    const days = eachDayOfInterval({ start: weekStart, end: weekEndInclusive });
    return days.map((d) => {
      const day0 = startOfDay(d);
      const next = addDays(day0, 1);
      const ventas = salesFetched.reduce((sum, sale) => {
        if (sale.estado === 'cancelada' || sale.estado === 'pendiente') return sum;
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
  }, [salesFetched, chartTimeRange]);

  const chartCardTitle = periodGranularity === 'month' ? 'Ventas por mes' : 'Ventas por día';
  const chartCardSubtitle =
    periodGranularity === 'month'
      ? '7 meses: 3 anteriores, mes seleccionado y 3 posteriores'
      : periodGranularity === 'week'
        ? 'Semana seleccionada (lun–dom)'
        : 'Semana lun–dom que incluye el día seleccionado';

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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:gap-2 md:gap-3">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-slate-200/80 dark:border-slate-800/40 pb-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pb-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-900 dark:text-slate-100 sm:text-xl lg:text-2xl">Panel</h1>
          <p className="truncate text-[11px] text-slate-600 dark:text-slate-500 sm:text-sm">Resumen del periodo</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
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

      <div className="grid min-h-0 shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4 lg:gap-3">
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

      {/* Móvil: mismas tarjetas que en escritorio, reparten el alto restante (sin scroll de página) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:hidden">
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-2">
          <Card
            role="button"
            tabIndex={0}
            onClick={goInventarioStock}
            onKeyDown={stockCardKeyHandler}
            className={cn(
              'flex min-h-0 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50',
              'cursor-pointer transition-colors active:scale-[0.99] hover:border-amber-500/35 hover:bg-slate-100 dark:bg-slate-900/70',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40'
            )}
          >
            <CardHeader className="shrink-0 space-y-0 px-2 py-1.5">
              <CardTitle className="flex items-center justify-between gap-1 text-[11px] leading-tight text-slate-900 dark:text-slate-100">
                <span className="flex min-w-0 items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="truncate">Stock bajo</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600 dark:text-slate-500" aria-hidden />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2 pt-0">
              {stockLoading ? (
                <div className="space-y-1.5">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-7 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/50" />
                  ))}
                </div>
              ) : lowStockProducts.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 py-1 text-center text-slate-600 dark:text-slate-500">
                  <Package className="h-6 w-6 shrink-0 text-slate-600 opacity-80" />
                  <p className="text-[11px] leading-snug">Sin alertas</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {lowStockProducts.slice(0, 8).map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between gap-1 rounded-md bg-slate-200/60 dark:bg-slate-800/30 px-1.5 py-1"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-medium text-slate-800 dark:text-slate-200">{product.nombre}</p>
                        <p className="text-[9px] text-slate-600 dark:text-slate-500">{product.sku}</p>
                      </div>
                      <p
                        className={cn(
                          'shrink-0 text-[10px] font-bold tabular-nums',
                          product.existencia === 0 ? 'text-red-400' : 'text-amber-400'
                        )}
                      >
                        {product.existencia}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card
            role="button"
            tabIndex={0}
            onClick={openTodaySalesDialog}
            onKeyDown={recentSalesCardKeyHandler}
            className={cn(
              'flex min-h-0 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50',
              'cursor-pointer transition-colors active:scale-[0.99] hover:border-cyan-500/35 hover:bg-slate-100 dark:bg-slate-900/70',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40'
            )}
          >
            <CardHeader className="shrink-0 space-y-0 px-2 py-1.5">
              <CardTitle className="flex items-center justify-between gap-1 text-[11px] leading-tight text-slate-900 dark:text-slate-100">
                <span className="flex min-w-0 items-center gap-1">
                  <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate">Ventas recientes</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600 dark:text-slate-500" aria-hidden />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2 pt-0">
              {salesLoading ? (
                <div className="space-y-1.5">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-7 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/50" />
                  ))}
                </div>
              ) : kpiSales.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 py-1 text-center text-slate-600 dark:text-slate-500">
                  <Receipt className="h-6 w-6 shrink-0 text-slate-600 opacity-80" />
                  <p className="text-[11px] leading-snug">Sin ventas en el periodo</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {kpiSales.slice(0, 8).map((sale) => (
                    <div
                      key={sale.id}
                      className="flex items-center justify-between gap-1 rounded-md bg-slate-200/60 dark:bg-slate-800/30 px-1.5 py-1"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-medium text-slate-800 dark:text-slate-200">{sale.folio}</p>
                        <p className="text-[9px] text-slate-600 dark:text-slate-500">
                          {formatInAppTimezone(
                            sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt),
                            { hour: '2-digit', minute: '2-digit' }
                          )}
                          {sale.formaPago === 'TTS' && outgoingTransferPendingIds.has(sale.id) ? (
                            <span className="text-amber-400"> · Trasp.</span>
                          ) : null}
                        </p>
                      </div>
                      <p className="shrink-0 text-[10px] font-bold tabular-nums text-cyan-400">
                        {formatMoney(sale.total)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
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
                  {chartCardTitle}
                </span>
                <span className="text-[10px] font-normal text-slate-600 dark:text-slate-500 sm:text-xs">
                  {chartCardSubtitle}
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
                    <LineChart
                      data={chartData}
                      margin={{ top: 12, right: 8, left: 4, bottom: 36 }}
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
                        angle={periodGranularity === 'month' ? -16 : -28}
                        textAnchor="end"
                        height={periodGranularity === 'month' ? 44 : 52}
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
                        cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '4 4' }}
                      />
                      <Line
                        type="linear"
                        dataKey="ventas"
                        stroke={LINE_STROKE}
                        strokeWidth={2.5}
                        isAnimationActive={false}
                        dot={(props: { cx?: number; cy?: number }) => {
                          const { cx, cy } = props;
                          if (cx == null || cy == null) return <g />;
                          const s = 7;
                          return (
                            <rect
                              x={cx - s / 2}
                              y={cy - s / 2}
                              width={s}
                              height={s}
                              rx={1}
                              fill={LINE_DOT_FILL}
                              stroke={LINE_DOT_STROKE}
                              strokeWidth={1.5}
                            />
                          );
                        }}
                        activeDot={(props: { cx?: number; cy?: number }) => {
                          const { cx, cy } = props;
                          if (cx == null || cy == null) return <g />;
                          const s = 9;
                          return (
                            <rect
                              x={cx - s / 2}
                              y={cy - s / 2}
                              width={s}
                              height={s}
                              rx={1}
                              fill="#22d3ee"
                              stroke="#cffafe"
                              strokeWidth={1.5}
                            />
                          );
                        }}
                      />
                    </LineChart>
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
                  Toca para ver ventas y reimprimir tickets
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={todaySalesOpen}
        onOpenChange={(open) => {
          setTodaySalesOpen(open);
          setReprintDayKey(getMexicoDateKey());
        }}
      >
        <DialogContent className="flex w-full min-w-0 max-h-[92dvh] flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,48rem)] lg:max-w-[min(92vw,56rem)]">
          <DialogHeader className="shrink-0 space-y-0 border-b border-slate-200 dark:border-slate-800/80 px-4 pb-3 pt-4 pr-14 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <DialogTitle>Ventas del día</DialogTitle>
                <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                  Elegí la fecha y reimprimí el ticket de cada venta.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Label htmlFor="reprint-day" className="text-xs text-slate-600 dark:text-slate-400">
                    Fecha
                  </Label>
                  <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-initial">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 border-slate-300 dark:border-slate-600"
                      aria-label="Día anterior"
                      onClick={() => setReprintDayKey((k) => shiftMexicoDateKey(k, -1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Input
                      id="reprint-day"
                      type="date"
                      max={reprintTodayKey}
                      value={reprintDayKey}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) setReprintDayKey(v);
                      }}
                      className="h-9 w-auto min-w-[10.5rem] flex-1 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900 dark:[color-scheme:dark] sm:flex-initial [&::-webkit-calendar-picker-indicator]:opacity-90 dark:[&::-webkit-calendar-picker-indicator]:invert"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 border-slate-300 dark:border-slate-600"
                      aria-label="Día siguiente"
                      disabled={!reprintCanGoNext}
                      onClick={() => setReprintDayKey((k) => shiftMexicoDateKey(k, 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-cyan-400"
                title="Reporte de ventas del día (térmica)"
                aria-label="Imprimir reporte térmico del día seleccionado"
                disabled={reprintSalesSorted.length === 0}
                onClick={() => {
                  printThermalDailySalesReport({
                    fechaLabel: formatInAppTimezone(reprintDayStart, {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    }),
                    sucursalId: effectiveSucursalId,
                    ventas: reprintSalesSorted,
                  });
                }}
              >
                <Printer className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {reprintSalesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                ))}
              </div>
            ) : reprintSalesSorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-600 dark:text-slate-500">
                <Receipt className="mb-2 h-10 w-10 text-slate-600" />
                <p className="text-sm">No hay ventas en esta fecha</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {reprintSalesSorted.map((sale: Sale) => (
                  <li
                    key={sale.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800/60 bg-slate-200 dark:bg-slate-800/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                        <span
                          className="shrink-0"
                          title={saleIsInvoiced(sale) ? 'Facturada' : 'Sin facturar'}
                          aria-label={saleIsInvoiced(sale) ? 'Facturada' : 'Sin facturar'}
                        >
                          {saleIsInvoiced(sale) ? (
                            <BadgeCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                          ) : (
                            <FileQuestion className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
                          )}
                        </span>
                        <span className="truncate">{sale.folio}</span>
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">
                        {formatInAppTimezone(
                          sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt),
                          { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
                        )}
                        {saleListaCancelacionEtiqueta(sale) ? (
                          <span className="ml-2 text-amber-400">
                            · {saleListaCancelacionEtiqueta(sale)}
                          </span>
                        ) : null}
                        {sale.estado === 'pendiente' ? (
                          <span className="ml-2 text-amber-400">· Pendiente de cobro (fiado)</span>
                        ) : null}
                        {sale.formaPago === 'TTS' && outgoingTransferPendingIds.has(sale.id) ? (
                          <span className="ml-2 text-amber-400">· Traspaso pendiente recepción</span>
                        ) : null}
                      </p>
                      <p
                        className={cn(
                          'text-sm font-semibold tabular-nums text-cyan-400',
                          sale.estado === 'cancelada' && 'text-slate-500 line-through decoration-slate-500/60'
                        )}
                      >
                        {formatMoney(sale.total)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-stretch gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-700 hover:text-white focus-visible:bg-slate-700 focus-visible:text-white active:bg-slate-800 active:text-white dark:hover:text-slate-50 dark:focus-visible:text-slate-50 dark:active:text-slate-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          void printThermalTicketFromSale(sale);
                        }}
                      >
                        <Printer className="mr-2 h-4 w-4" />
                        Reimprimir
                      </Button>
                      {isAdmin &&
                      sale.estado !== 'cancelada' &&
                      !sale.facturaId &&
                      !(sale.formaPago === 'TTS' && outgoingTransferPendingIds.has(sale.id)) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-red-500/35 text-red-600 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/15"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSaleToCancel(sale);
                            setSaleCancelOpen(true);
                          }}
                        >
                          Cancelar
                        </Button>
                      ) : null}
                    </div>
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

      <AlertDialog
        open={saleCancelOpen}
        onOpenChange={(open) => {
          setSaleCancelOpen(open);
          if (!open) setSaleToCancel(null);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta venta?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              El ticket{' '}
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {saleToCancel?.folio ?? '—'}
              </span>{' '}
              quedará como venta cancelada, se reintegrará el inventario y el importe no se contará en totales del
              día. El registro no se elimina.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={saleCancelBusy}
              className="border-slate-300 dark:border-slate-600"
            >
              Volver
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={saleCancelBusy}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void confirmCancelSaleFromPanel()}
            >
              {saleCancelBusy ? 'Cancelando…' : 'Confirmar cancelación'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
