import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  FileText,
  Boxes,
  Search,
  Wallet,
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
  useSales,
  useLowStockProducts,
  useEffectiveSucursalId,
  useOutgoingPendingTransferIds,
} from '@/hooks';
import { cn, formatMoney } from '@/lib/utils';
import { printThermalDailySalesReport, printThermalTicketFromSale } from '@/lib/printTicket';
import { listAbonosCobrosEnRangoFirestore } from '@/lib/firestore/cajaFirestore';
import type { CajaAbonoCobro } from '@/types';
import {
  buildHistorialCobrosMovimientos,
  computeCobradoPeriodo,
  labelFormaPagoCaja,
  type HistorialCobroMovimiento,
} from '@/lib/cajaResumen';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import { FORMAS_PAGO, type Sale, type SaleItem } from '@/types';
import {
  DashboardPeriodPopover,
  rangeForGranularity,
  type PeriodGranularity,
} from '@/components/ui-custom/DashboardPeriodPopover';
import { useAuthStore, useAppStore, getResolvedIsDark } from '@/stores';
import { cancelSale } from '@/db/database';
import { saleListaCancelacionEtiqueta } from '@/lib/saleCancelacion';
import { saleIsInvoiced } from '@/lib/saleInvoiced';
import { parrafosAyudaCancelacionVentaAdmin } from '@/lib/cancelacionVentaAdminUi';
import { efectivoNetoEnCajaPorVenta } from '@/lib/cajaResumen';
import { saleEnRangoHistorial, saleFechaHistorial } from '@/lib/saleHistorialFecha';
import {
  nombreClienteVenta,
  nombreCajeroVenta,
  saleMatchesTicketSearch,
} from '@/lib/saleTicketUi';
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
const CHART_AREA_GRADIENT_ID = 'dashboardVentasAreaFill';

const WEEKDAY_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

/** Altura mínima del plot cuando el viewport es bajo; en pantallas normales se estira con flex. */
const CHART_PLOT_MIN_HEIGHT_PX = 200;

type StatAccent = 'emerald' | 'cyan' | 'blue' | 'violet';

const STAT_ACCENT: Record<
  StatAccent,
  { ring: string; glow: string; wash: string; iconShadow: string }
> = {
  emerald: {
    ring: 'from-emerald-500/80 via-emerald-400/40 to-transparent',
    glow: 'hover:shadow-emerald-500/15 dark:hover:shadow-emerald-400/10',
    wash: 'from-emerald-500/[0.07] via-transparent to-transparent dark:from-emerald-400/[0.12]',
    iconShadow: 'shadow-emerald-500/30',
  },
  cyan: {
    ring: 'from-cyan-500/80 via-cyan-400/40 to-transparent',
    glow: 'hover:shadow-cyan-500/15 dark:hover:shadow-cyan-400/10',
    wash: 'from-cyan-500/[0.07] via-transparent to-transparent dark:from-cyan-400/[0.12]',
    iconShadow: 'shadow-cyan-500/30',
  },
  blue: {
    ring: 'from-blue-500/80 via-blue-400/40 to-transparent',
    glow: 'hover:shadow-blue-500/15 dark:hover:shadow-blue-400/10',
    wash: 'from-blue-500/[0.07] via-transparent to-transparent dark:from-blue-400/[0.12]',
    iconShadow: 'shadow-blue-500/30',
  },
  violet: {
    ring: 'from-violet-500/80 via-violet-400/40 to-transparent',
    glow: 'hover:shadow-violet-500/15 dark:hover:shadow-violet-400/10',
    wash: 'from-violet-500/[0.07] via-transparent to-transparent dark:from-violet-400/[0.12]',
    iconShadow: 'shadow-violet-500/30',
  },
};

function ListRowSkeleton() {
  return (
    <div className="h-11 animate-pulse rounded-xl bg-gradient-to-r from-slate-200/80 via-slate-100/90 to-slate-200/80 dark:from-slate-800/70 dark:via-slate-800/40 dark:to-slate-800/70" />
  );
}

function EmptyStateBlock({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex min-h-[7rem] flex-1 flex-col items-center justify-center gap-2 px-3 py-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200/70 ring-1 ring-slate-300/50 dark:bg-slate-800/60 dark:ring-slate-700/50">
        <Icon className="h-6 w-6 text-slate-500 opacity-80 dark:text-slate-400" />
      </div>
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{title}</p>
      {hint ? <p className="max-w-[14rem] text-[10px] leading-snug text-slate-500 dark:text-slate-500">{hint}</p> : null}
    </div>
  );
}

function saleEstadoEtiqueta(s: Sale): string {
  if (s.estado === 'pendiente') return 'Pendiente de cobro';
  if (s.estado === 'cancelada') return 'Cancelada';
  if (s.estado === 'facturada') return 'Facturada';
  return 'Completada';
}

function formatChartYAxisTick(value: number): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1_000)}k`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

function lineaDescripcion(item: SaleItem): string {
  const n = item.productoNombre?.trim() || item.producto?.nombre?.trim();
  return n || 'Artículo';
}

function labelFormaPago(clave: string): string {
  return FORMAS_PAGO.find((f) => f.clave === clave)?.descripcion ?? clave;
}

type ChartTimeRange =
  | { mode: 'week'; weekStart: Date; weekEndExclusive: Date }
  | { mode: 'monthDays'; monthStart: Date };

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  trend: 'up' | 'down' | 'neutral';
  trendValue: string;
  iconGradient: string;
  accent?: StatAccent;
  drillChip?: string | null;
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  trendValue,
  iconGradient,
  accent = 'cyan',
  drillChip,
}: StatCardProps) {
  const a = STAT_ACCENT[accent];
  return (
    <Card
      className={cn(
        'group relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm',
        'dark:border-slate-800/60 dark:bg-slate-900/55',
        'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg',
        a.glow,
        'max-md:min-h-0 md:min-h-[6.75rem] lg:min-h-[8rem] xl:min-h-[8.75rem]'
      )}
    >
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r', a.ring)}
      />
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', a.wash)}
      />
      <CardContent className="relative flex flex-1 flex-col p-3 sm:p-3.5 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 max-w-[calc(100%-2.75rem)] text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">
            {title}
          </h3>
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-md transition-transform duration-200 group-hover:scale-105 md:h-10 md:w-10',
              iconGradient,
              a.iconShadow
            )}
          >
            <Icon className="h-4 w-4 text-white md:h-[1.125rem] md:w-[1.125rem]" />
          </div>
        </div>

        <p className="mt-2 text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-50 max-md:leading-tight sm:mt-3 sm:text-2xl lg:text-[1.75rem]">
          {value}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400 max-md:leading-tight sm:mt-1 sm:text-xs">
          {description}
        </p>

        <div className="mt-auto min-h-0 pt-2">
          {drillChip ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 sm:text-[11px]">
              <span className="truncate">Viendo: {drillChip}</span>
            </span>
          ) : (
            <div
              className={cn(
                'flex items-center gap-1 text-[10px] sm:text-xs',
                trend === 'up'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : trend === 'down'
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-slate-500 dark:text-slate-400'
              )}
            >
              {trend === 'up' ? (
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
              ) : trend === 'down' ? (
                <ArrowDownRight className="h-3.5 w-3.5 shrink-0" />
              ) : null}
              <span className="line-clamp-2 leading-tight">{trendValue}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function totalPiezasEnVenta(sale: Sale): number {
  return (sale.productos ?? []).reduce((sum, line) => sum + (Number(line.cantidad) || 0), 0);
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
  const isDark = useAppStore((s) => getResolvedIsDark(s));
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const [dateOpen, setDateOpen] = useState(false);
  const [periodGranularity, setPeriodGranularity] = useState<PeriodGranularity>('day');
  const [todaySalesOpen, setTodaySalesOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [reprintSaleDetail, setReprintSaleDetail] = useState<Sale | null>(null);
  const [reprintAbonoDetail, setReprintAbonoDetail] = useState<CajaAbonoCobro | null>(null);
  const [reprintDayKey, setReprintDayKey] = useState(() => getMexicoDateKey());
  const [reprintSearchMode, setReprintSearchMode] = useState(false);
  const [reprintSearchQuery, setReprintSearchQuery] = useState('');
  const [abonosFetched, setAbonosFetched] = useState<CajaAbonoCobro[]>([]);
  const [abonosLoading, setAbonosLoading] = useState(false);
  const [saleCancelOpen, setSaleCancelOpen] = useState(false);
  const [saleToCancel, setSaleToCancel] = useState<Sale | null>(null);
  const [saleCancelBusy, setSaleCancelBusy] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const t = startOfDayFromDateKey(getMexicoDateKey());
    return { from: t, to: t };
  });

  /** Día concreto (inicio local) para filtrar solo los KPI de arriba; la gráfica sigue mostrando el periodo visual. */
  const [kpiDrillDownDayStart, setKpiDrillDownDayStart] = useState<Date | null>(null);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  /**
   * Al hacer clic en «Ventas recientes», un pointerdown en document puede borrar el drill-down antes del click.
   * Guardamos aquí la fecha México a mostrar en el diálogo (día del gráfico o hoy) en la fase capture de la tarjeta.
   */
  const ventasRecientesOpenSnapshotRef = useRef<string | undefined>(undefined);

  const onVentasRecientesPointerDownCapture = useCallback(() => {
    ventasRecientesOpenSnapshotRef.current = kpiDrillDownDayStart
      ? getMexicoDateKey(kpiDrillDownDayStart)
      : getMexicoDateKey();
  }, [kpiDrillDownDayStart]);

  const { inicio, fin } = useMemo(() => dateRangeToBounds(dateRange), [dateRange]);

  const kpiPeriodStart = kpiDrillDownDayStart ?? inicio;
  const kpiPeriodEndExclusive = kpiDrillDownDayStart ? addDays(kpiDrillDownDayStart, 1) : fin;

  /** Rango del gráfico: semana lun–dom (día/semana) o cada día del mes seleccionado (modo mes). */
  const chartTimeRange = useMemo((): ChartTimeRange => {
    const anchor = startOfDay(dateRange?.from ?? startOfDayFromDateKey(getMexicoDateKey()));
    if (periodGranularity === 'month') {
      return { mode: 'monthDays', monthStart: startOfMonth(anchor) };
    }
    // Usa el rango ya normalizado (semana completa) cuando existe.
    const weekStart =
      periodGranularity === 'week' && dateRange?.from
        ? startOfDay(dateRange.from)
        : startOfWeek(anchor, { weekStartsOn: 1 });
    const weekEndInclusive =
      periodGranularity === 'week' && dateRange?.to
        ? startOfDay(dateRange.to)
        : startOfDay(endOfWeek(weekStart, { weekStartsOn: 1 }));
    return { mode: 'week', weekStart, weekEndExclusive: addDays(weekEndInclusive, 1) };
  }, [periodGranularity, dateRange?.from, dateRange?.to]);

  /** Cubre el periodo KPI, el rango del gráfico y el día de reimpresión de tickets. */
  const reprintDayStart = useMemo(() => startOfDayFromDateKey(reprintDayKey), [reprintDayKey]);
  const reprintDayEnd = useMemo(() => addDays(reprintDayStart, 1), [reprintDayStart]);

  const fetchBounds = useMemo(() => {
    let chartStart: Date;
    let chartEndExclusive: Date;
    if (chartTimeRange.mode === 'monthDays') {
      chartStart = startOfMonth(chartTimeRange.monthStart);
      chartEndExclusive = addDays(endOfMonth(chartTimeRange.monthStart), 1);
    } else {
      chartStart = chartTimeRange.weekStart;
      chartEndExclusive = chartTimeRange.weekEndExclusive;
    }
    const fetchStart = new Date(
      Math.min(inicio.getTime(), chartStart.getTime(), reprintDayStart.getTime())
    );
    const fetchEnd = new Date(
      Math.max(fin.getTime(), chartEndExclusive.getTime(), reprintDayEnd.getTime())
    );
    return { fetchStart, fetchEnd };
  }, [inicio, fin, chartTimeRange, reprintDayStart, reprintDayEnd]);

  const { sales: salesFetched, loading: salesLoading } = useSalesByDateRange(
    fetchBounds.fetchStart,
    fetchBounds.fetchEnd
  );
  const { sales: ticketCatalogSales, loading: ticketCatalogLoading } = useSales(500);

  useEffect(() => {
    let cancelled = false;
    if (!effectiveSucursalId) {
      setAbonosFetched([]);
      setAbonosLoading(false);
      return;
    }
    setAbonosLoading(true);
    void (async () => {
      try {
        const rows = await listAbonosCobrosEnRangoFirestore(
          effectiveSucursalId,
          fetchBounds.fetchStart,
          fetchBounds.fetchEnd
        );
        if (!cancelled) setAbonosFetched(rows);
      } catch {
        if (!cancelled) setAbonosFetched([]);
      } finally {
        if (!cancelled) setAbonosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveSucursalId, fetchBounds.fetchStart, fetchBounds.fetchEnd]);

  useEffect(() => {
    setKpiDrillDownDayStart(null);
  }, [dateRange?.from, dateRange?.to, periodGranularity]);

  useEffect(() => {
    if (!kpiDrillDownDayStart) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-preserve-kpi-drill]')) return;
      const el = chartPanelRef.current;
      if (el && !el.contains(t as Node)) {
        setKpiDrillDownDayStart(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [kpiDrillDownDayStart]);

  useEffect(() => {
    if (!kpiDrillDownDayStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKpiDrillDownDayStart(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kpiDrillDownDayStart]);

  const kpiSales = useMemo(() => {
    const i0 = kpiPeriodStart.getTime();
    const f0 = kpiPeriodEndExclusive.getTime();
    return salesFetched.filter((s) => {
      const x = saleFechaHistorial(s).getTime();
      return x >= i0 && x < f0;
    });
  }, [salesFetched, kpiPeriodStart, kpiPeriodEndExclusive]);

  const kpiVentasParaTotales = useMemo(
    () => kpiSales.filter((s) => s.estado !== 'cancelada' && s.estado !== 'pendiente'),
    [kpiSales]
  );

  const kpiAbonos = useMemo(() => {
    const i0 = kpiPeriodStart.getTime();
    const f0 = kpiPeriodEndExclusive.getTime();
    return abonosFetched.filter((a) => {
      const t = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      return Number.isFinite(t) && t >= i0 && t < f0;
    });
  }, [abonosFetched, kpiPeriodStart, kpiPeriodEndExclusive]);

  const totals = useMemo(() => {
    const cobrado = computeCobradoPeriodo(kpiVentasParaTotales, kpiAbonos);
    return {
      total: cobrado.cobradoTotal,
      count: cobrado.movimientos,
      cobradoVentas: cobrado.cobradoVentas,
      cobradoAbonos: cobrado.cobradoAbonos,
    };
  }, [kpiVentasParaTotales, kpiAbonos]);

  /**
   * Por cada cliente (incl. mostrador), promedio de piezas por sus tickets; luego la media de esos promedios.
   * Así un cliente con muchas compras no domina el indicador frente a otros con pocas.
   */
  const promedioPiezasPorTicketPorCliente = useMemo(() => {
    const ventas = kpiVentasParaTotales;
    if (ventas.length === 0) return 0;
    const byCliente = new Map<string, { piezas: number; tickets: number }>();
    for (const sale of ventas) {
      const cid = (sale.clienteId ?? 'mostrador').trim() || 'mostrador';
      const pzs = totalPiezasEnVenta(sale);
      const cur = byCliente.get(cid) ?? { piezas: 0, tickets: 0 };
      cur.piezas += pzs;
      cur.tickets += 1;
      byCliente.set(cid, cur);
    }
    const mediasPorCliente: number[] = [];
    for (const { piezas, tickets } of byCliente.values()) {
      if (tickets > 0) mediasPorCliente.push(piezas / tickets);
    }
    if (mediasPorCliente.length === 0) return 0;
    return mediasPorCliente.reduce((a, b) => a + b, 0) / mediasPorCliente.length;
  }, [kpiVentasParaTotales]);
  const { products: lowStockProducts, loading: stockLoading } = useLowStockProducts();
  const lowStockHasZero = useMemo(
    () => lowStockProducts.some((p) => p.existencia === 0),
    [lowStockProducts]
  );
  const outgoingTransferPendingIds = useOutgoingPendingTransferIds();

  const reprintSalesRaw = useMemo(() => {
    return salesFetched.filter((s) => saleEnRangoHistorial(s, reprintDayStart, reprintDayEnd));
  }, [salesFetched, reprintDayStart, reprintDayEnd]);
  const reprintSalesSorted = useMemo(
    () =>
      [...reprintSalesRaw].sort(
        (a, b) => saleFechaHistorial(b).getTime() - saleFechaHistorial(a).getTime()
      ),
    [reprintSalesRaw]
  );
  const reprintAbonosDelDia = useMemo(() => {
    const t0 = reprintDayStart.getTime();
    const t1 = reprintDayEnd.getTime();
    return abonosFetched.filter((a) => {
      const t = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      return Number.isFinite(t) && t >= t0 && t < t1;
    });
  }, [abonosFetched, reprintDayStart, reprintDayEnd]);
  const reprintMovimientos = useMemo(
    () => buildHistorialCobrosMovimientos(reprintSalesSorted, reprintAbonosDelDia),
    [reprintSalesSorted, reprintAbonosDelDia]
  );
  const reprintSearchResults = useMemo(() => {
    const q = reprintSearchQuery.trim();
    if (!q) return [];
    return ticketCatalogSales
      .filter((s) => saleMatchesTicketSearch(s, q))
      .sort((a, b) => saleFechaHistorial(b).getTime() - saleFechaHistorial(a).getTime());
  }, [ticketCatalogSales, reprintSearchQuery]);
  const reprintSearchMovimientos = useMemo(
    () => buildHistorialCobrosMovimientos(reprintSearchResults, []),
    [reprintSearchResults]
  );
  const reprintListMovimientos: HistorialCobroMovimiento[] = reprintSearchMode
    ? reprintSearchMovimientos
    : reprintMovimientos;
  const reprintListLoading =
    reprintSearchMode ? ticketCatalogLoading : salesLoading || abonosLoading;
  const reprintTodayKey = getMexicoDateKey();
  const reprintCanGoNext = reprintDayKey < reprintTodayKey;

  const goInventarioStock = useCallback(() => {
    setStockDialogOpen(false);
    navigate('/inventario?tab=stock');
  }, [navigate]);

  const openStockDialog = useCallback(() => {
    setStockDialogOpen(true);
  }, []);

  const closeTodaySalesDialog = useCallback(() => {
    setTodaySalesOpen(false);
    setReprintSaleDetail(null);
    setReprintAbonoDetail(null);
    setReprintDayKey(getMexicoDateKey());
    setReprintSearchMode(false);
    setReprintSearchQuery('');
  }, []);

  const openTodaySalesDialog = useCallback(() => {
    let dayKey: string;
    if (kpiDrillDownDayStart) {
      dayKey = getMexicoDateKey(kpiDrillDownDayStart);
    } else {
      const snap = ventasRecientesOpenSnapshotRef.current;
      ventasRecientesOpenSnapshotRef.current = undefined;
      dayKey = snap !== undefined ? snap : getMexicoDateKey();
    }
    setReprintSaleDetail(null);
    setReprintSearchMode(false);
    setReprintSearchQuery('');
    setReprintDayKey(dayKey);
    setTodaySalesOpen(true);
  }, [kpiDrillDownDayStart]);

  const confirmCancelSaleFromPanel = useCallback(async () => {
    if (!saleToCancel) return;
    setSaleCancelBusy(true);
    try {
      const saleCanceled = saleToCancel;
      await cancelSale(saleCanceled.id, {
        motivo: 'Cancelación desde panel (administrador)',
        ...(effectiveSucursalId ? { sucursalId: effectiveSucursalId } : {}),
        cancelacionMotivo: 'panel',
      });
      const efDev = efectivoNetoEnCajaPorVenta(saleCanceled);
      addToast({
        type: 'success',
        message: `Venta cancelada. Inventario reintegrado.${efDev > 0.005 ? ` Devolución en efectivo: ${formatMoney(efDev)}.` : ''} El ticket ya no cuenta en totales.`,
        logToAppEvents: true,
      });
      setSaleCancelOpen(false);
      setSaleToCancel(null);
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo cancelar la venta',
        logToAppEvents: true,
      });
    } finally {
      setSaleCancelBusy(false);
    }
  }, [saleToCancel, effectiveSucursalId, addToast]);

  const stockButtonKeyHandler = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openStockDialog();
    }
  };

  const recentSalesButtonKeyHandler = (e: React.KeyboardEvent) => {
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
      return format(from, 'd MMM yyyy', { locale: es });
    }
    if (periodGranularity === 'week') {
      return `${format(from, 'd MMM', { locale: es })} – ${format(to, 'd MMM yyyy', { locale: es })}`;
    }
    const m = format(from, 'MMMM yyyy', { locale: es });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }, [dateRange, periodGranularity]);

  /** Puntos: lun–dom (día/semana) o un punto por cada día del mes (modo mes). Criterio de caja (cobrado). */
  const chartData = useMemo(() => {
    const selectedDayStart =
      periodGranularity === 'day' && dateRange?.from ? startOfDay(dateRange.from) : null;
    const drillMs = kpiDrillDownDayStart ? startOfDay(kpiDrillDownDayStart).getTime() : null;

    const cobradoDia = (day0: Date, next: Date) => {
      const ventasDelDia = salesFetched.filter((sale) => {
        if (sale.estado === 'cancelada' || sale.estado === 'pendiente') return false;
        const x = saleFechaHistorial(sale).getTime();
        return x >= day0.getTime() && x < next.getTime();
      });
      const abonosDelDia = abonosFetched.filter((a) => {
        const t = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        return Number.isFinite(t) && t >= day0.getTime() && t < next.getTime();
      });
      const cobrado = computeCobradoPeriodo(ventasDelDia, abonosDelDia);
      return {
        ventas: cobrado.cobradoTotal,
        transacciones: cobrado.movimientos,
      };
    };

    if (chartTimeRange.mode === 'monthDays') {
      const ms = startOfDay(chartTimeRange.monthStart);
      const last = endOfMonth(ms);
      const days = eachDayOfInterval({ start: ms, end: last });
      return days.map((d) => {
        const day0 = startOfDay(d);
        const next = addDays(day0, 1);
        const { ventas, transacciones } = cobradoDia(day0, next);
        return {
          name: String(d.getDate()),
          ventas,
          transacciones,
          fullLabel: format(d, "EEEE d 'de' MMMM yyyy", { locale: es }),
          dayStartMs: day0.getTime(),
          isKpiDrillDown: drillMs !== null && day0.getTime() === drillMs,
        };
      });
    }
    const { weekStart, weekEndExclusive } = chartTimeRange;
    const weekEndInclusive = addDays(weekEndExclusive, -1);
    const days = eachDayOfInterval({ start: weekStart, end: weekEndInclusive });
    return days.map((d) => {
      const day0 = startOfDay(d);
      const next = addDays(day0, 1);
      const { ventas, transacciones } = cobradoDia(day0, next);
      const dowMon0 = (d.getDay() + 6) % 7;
      const isSelectedInChart =
        selectedDayStart !== null && day0.getTime() === selectedDayStart.getTime();
      return {
        name: WEEKDAY_SHORT_ES[dowMon0]!,
        ventas,
        transacciones,
        fullLabel: format(d, 'EEEE d MMM yyyy', { locale: es }),
        dayStartMs: day0.getTime(),
        isSelectedInChart,
        isKpiDrillDown: drillMs !== null && day0.getTime() === drillMs,
      };
    });
  }, [
    salesFetched,
    abonosFetched,
    chartTimeRange,
    periodGranularity,
    dateRange?.from,
    kpiDrillDownDayStart,
  ]);

  /** Mejor día del mes en facturación (solo vista mes). */
  const chartMonthPeak = useMemo(() => {
    if (periodGranularity !== 'month' || chartTimeRange.mode !== 'monthDays') return null;
    let maxV = 0;
    let best: { label: string; name: string } | null = null;
    for (const row of chartData) {
      const v = row.ventas;
      if (v > maxV) {
        maxV = v;
        best = { label: row.fullLabel, name: row.name };
      }
    }
    if (!best || maxV <= 0) return null;
    return { total: maxV, fullLabel: best.label, dayNum: best.name };
  }, [periodGranularity, chartTimeRange, chartData]);

  /**
   * Recharts pasa `activeTooltipIndex` según la posición X en el área del gráfico (eje).
   * Así se puede elegir un día tocando la franja vertical de ese día, no solo el punto (crítico cuando ventas=0 y el punto queda en el borde).
   */
  const handleChartPlotClick = useCallback(
    (state: { activeTooltipIndex?: number } | null | undefined) => {
      const idx = state?.activeTooltipIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < chartData.length) {
        const row = chartData[idx];
        if (row && typeof row.dayStartMs === 'number') {
          setKpiDrillDownDayStart(startOfDay(new Date(row.dayStartMs)));
          return;
        }
      }
      setKpiDrillDownDayStart(null);
    },
    [chartData]
  );

  /** Etiqueta del eje X (ej. "Mié") del día consultado en modo "día" (calendario). */
  const selectedDayChartCategory = useMemo(() => {
    if (periodGranularity !== 'day') return null;
    for (const r of chartData) {
      if ('isSelectedInChart' in r && r.isSelectedInChart) return String(r.name);
    }
    return null;
  }, [chartData, periodGranularity]);

  /** Categoría en el eje X del día usado para los KPI (clic en la gráfica). */
  const kpiDrillChartCategory = useMemo(() => {
    if (!kpiDrillDownDayStart) return null;
    const t = startOfDay(kpiDrillDownDayStart).getTime();
    for (const r of chartData) {
      if ('dayStartMs' in r && r.dayStartMs === t && 'name' in r) return String(r.name);
    }
    return null;
  }, [chartData, kpiDrillDownDayStart]);

  /** Etiquetas eje X: resalta día del calendario (modo día) o día KPI (clic). */
  const periodChartTick = useCallback(
    (props: { x: number; y: number; payload: { value: string | number }; index: number }) => {
      const { x, y, payload, index } = props;
      const row = chartData[index] as
        | { isSelectedInChart?: boolean; isKpiDrillDown?: boolean }
        | undefined;
      const drill = Boolean(row?.isKpiDrillDown);
      const sel = Boolean(row?.isSelectedInChart);
      const fill = drill ? '#fbbf24' : sel ? '#22d3ee' : '#64748b';
      const fw = drill || sel ? 700 : 400;
      const ang = periodGranularity === 'month' ? -32 : -28;
      const fs = periodGranularity === 'month' ? 10 : 11;
      return (
        <g transform={`translate(${x},${y})`}>
          <text
            dy={8}
            transform={`rotate(${ang})`}
            textAnchor="end"
            fill={fill}
            fontSize={fs}
            fontWeight={fw}
          >
            {payload.value}
          </text>
        </g>
      );
    },
    [chartData, periodGranularity]
  );

  const chartCardTitle =
    periodGranularity === 'month' ? 'Ventas diarias del mes' : 'Ventas por día';
  const chartCardSubtitle =
    periodGranularity === 'month'
      ? 'Cada punto es un día del mes · Toque un punto para ver solo ese día en las tarjetas de arriba; toque fuera del gráfico para volver al mes'
      : periodGranularity === 'week'
        ? 'Semana seleccionada (lun–dom) · Toque un punto para filtrar las tarjetas a ese día; toque fuera del gráfico para volver'
        : 'Semana lun–dom que incluye el día elegido · Toque un punto para filtrar las tarjetas; toque fuera del gráfico para volver al periodo';

  /** Cambia día/semana/mes conservando el ancla actual (no reinicia a “hoy”). */
  const handleGranularityChange = (g: PeriodGranularity) => {
    setPeriodGranularity(g);
    setDateRange((prev) => {
      const anchor = startOfDay(prev?.from ?? startOfDayFromDateKey(getMexicoDateKey()));
      return rangeForGranularity(g, anchor);
    });
  };

  /**
   * Botones del encabezado: si ya está activo ese modo, solo abre el calendario;
   * si cambia de modo, convierte el periodo actual (sin saltar a la fecha de hoy).
   */
  const handleHeaderGranularityClick = (g: PeriodGranularity) => {
    if (periodGranularity === g) {
      setDateOpen(true);
      return;
    }
    handleGranularityChange(g);
    setDateOpen(true);
  };

  const kpiDrillHint = useMemo(() => {
    if (!kpiDrillDownDayStart) return null;
    return format(kpiDrillDownDayStart, 'EEEE d MMM yyyy', { locale: es });
  }, [kpiDrillDownDayStart]);

  const chartGridStroke = isDark ? '#334155' : '#e2e8f0';
  const chartAxisStroke = isDark ? '#94a3b8' : '#64748b';
  const chartAxisLine = isDark ? '#475569' : '#cbd5e1';
  const chartTooltipBg = isDark ? '#0f172a' : '#ffffff';
  const chartTooltipBorder = isDark ? '#334155' : '#e2e8f0';
  const chartTooltipColor = isDark ? '#f1f5f9' : '#0f172a';
  const chartCursorStroke = isDark ? '#64748b' : '#94a3b8';

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full min-w-0 max-w-[100vw] flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto sm:gap-3.5 lg:gap-4',
        'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))]',
        'before:from-cyan-500/[0.06] before:via-transparent before:to-violet-500/[0.04]',
        'dark:before:from-cyan-400/[0.08] dark:before:via-transparent dark:before:to-violet-500/[0.06]'
      )}
    >
      <header className="flex shrink-0 flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3 shadow-sm backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/50 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl lg:text-[1.75rem]">
            Panel
          </h1>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
            Resumen · <span className="font-medium text-slate-700 dark:text-slate-300">{rangeLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
          <div
            className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-100/90 p-1 shadow-inner dark:border-slate-700/60 dark:bg-slate-950/50"
            role="group"
            aria-label="Periodo"
          >
            {(
              [
                { key: 'day' as const, label: 'Día' },
                { key: 'week' as const, label: 'Semana' },
                { key: 'month' as const, label: 'Mes' },
              ] as const
            ).map(({ key, label }) => {
              const active = periodGranularity === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleHeaderGranularityClick(key)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 sm:px-3.5 sm:text-sm',
                    active
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                      : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
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
                className="h-9 rounded-full border-cyan-500/35 bg-cyan-500/10 px-3.5 text-slate-900 shadow-sm hover:bg-cyan-500/15 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-slate-100 dark:hover:bg-cyan-400/15"
              >
                <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" />
                <span className="max-w-[10rem] truncate font-medium sm:max-w-none">{rangeLabel}</span>
              </Button>
            }
          />
        </div>
      </header>

      <div className="grid min-h-0 shrink-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 lg:gap-3.5">
        <StatCard
          title="Cobrado periodo"
          value={formatMoney(totals.total)}
          description={
            totals.cobradoAbonos > 0.005
              ? `${totals.count} mov. · abonos ${formatMoney(totals.cobradoAbonos)}`
              : `${totals.count} movimientos cobrados`
          }
          icon={DollarSign}
          trend="up"
          trendValue="Criterio de caja (día del cobro)"
          iconGradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
          accent="emerald"
          drillChip={kpiDrillHint}
        />
        <StatCard
          title="Ticket prom."
          value={formatMoney(totals.count > 0 ? totals.total / totals.count : 0)}
          description="Promedio por movimiento cobrado"
          icon={ShoppingCart}
          trend="neutral"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-cyan-500 to-cyan-600"
          accent="cyan"
          drillChip={kpiDrillHint}
        />
        <StatCard
          title="Unidades"
          value={kpiVentasParaTotales
            .reduce((sum, sale) => sum + (sale.productos?.length ?? 0), 0)
            .toString()}
          description="Líneas vendidas"
          icon={Package}
          trend="neutral"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-blue-500 to-blue-600"
          accent="blue"
          drillChip={kpiDrillHint}
        />
        <StatCard
          title="Piezas por ticket"
          value={promedioPiezasPorTicketPorCliente.toLocaleString('es-MX', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          })}
          description="Promedio entre clientes (pz por ticket de cada uno)"
          icon={Boxes}
          trend="neutral"
          trendValue="En el periodo"
          iconGradient="bg-gradient-to-br from-violet-500 to-violet-600"
          accent="violet"
          drillChip={kpiDrillHint}
        />
      </div>

      {/* Accesos compactos: Stock bajo y Ventas recientes */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={openStockDialog}
          onKeyDown={stockButtonKeyHandler}
          className={cn(
            'group flex min-w-0 items-center gap-2.5 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 text-left shadow-sm backdrop-blur-sm',
            'dark:border-slate-800/60 dark:bg-slate-900/55',
            'transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-md hover:shadow-amber-500/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
            'active:scale-[0.99]'
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-500/25">
            <AlertTriangle className="h-4 w-4 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                Stock bajo
              </span>
              {!stockLoading && lowStockProducts.length > 0 ? (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
                    lowStockHasZero
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {lowStockProducts.length}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-slate-400">
              {stockLoading
                ? 'Cargando…'
                : lowStockProducts.length === 0
                  ? 'Sin alertas'
                  : 'Ver productos'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-300" aria-hidden />
        </button>

        <button
          type="button"
          data-preserve-kpi-drill
          onPointerDownCapture={onVentasRecientesPointerDownCapture}
          onClick={openTodaySalesDialog}
          onKeyDown={recentSalesButtonKeyHandler}
          className={cn(
            'group flex min-w-0 items-center gap-2.5 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 text-left shadow-sm backdrop-blur-sm',
            'dark:border-slate-800/60 dark:bg-slate-900/55',
            'transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40 hover:shadow-md hover:shadow-cyan-500/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40',
            'active:scale-[0.99]'
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/25">
            <ShoppingCart className="h-4 w-4 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                Ventas recientes
              </span>
              {!salesLoading && !abonosLoading && totals.count > 0 ? (
                <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-cyan-700 dark:text-cyan-300">
                  {totals.count}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-slate-400">
              {salesLoading || abonosLoading ? 'Cargando…' : 'Historial del periodo'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-cyan-600 dark:group-hover:text-cyan-300" aria-hidden />
        </button>
      </div>

      {/* Gráfica a ancho completo, altura flexible */}
      <Card
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm',
          'dark:border-slate-800/60 dark:bg-slate-900/55'
        )}
      >
        <CardHeader className="shrink-0 space-y-2 py-3 sm:py-3.5">
          <CardTitle className="flex flex-col gap-1.5 text-sm text-slate-900 dark:text-slate-100 sm:text-base">
            <span className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/25">
                <TrendingUp className="h-4 w-4 text-white" />
              </span>
              <span className="font-semibold tracking-tight">{chartCardTitle}</span>
              {chartMonthPeak ? (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300 sm:text-[11px]">
                  Pico · {formatMoney(chartMonthPeak.total)}
                  <span className="hidden font-normal opacity-80 sm:inline">
                    · día {chartMonthPeak.dayNum}
                  </span>
                </span>
              ) : null}
            </span>
            <span className="line-clamp-2 pl-0 text-[10px] font-normal leading-snug text-slate-500 dark:text-slate-400 sm:pl-10 sm:text-xs xl:line-clamp-none">
              {chartCardSubtitle}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col p-2 pt-0 sm:p-3.5 sm:pt-0">
          <div
            ref={chartPanelRef}
            className="h-full min-h-[200px] w-full min-w-0 flex-1 rounded-xl bg-slate-50/60 p-1 dark:bg-slate-950/30"
            style={{ minHeight: CHART_PLOT_MIN_HEIGHT_PX }}
          >
            {salesLoading ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2">
                <div className="h-8 w-8 animate-pulse rounded-full bg-cyan-500/20" />
                <p className="text-xs text-slate-500">Cargando ventas…</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{
                        top: 12,
                        right: 8,
                        left: 0,
                        bottom: periodGranularity === 'month' ? 44 : 32,
                      }}
                      onClick={handleChartPlotClick}
                    >
                      <defs>
                        <linearGradient id={CHART_AREA_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity={isDark ? 0.35 : 0.28} />
                          <stop offset="70%" stopColor="#0891b2" stopOpacity={isDark ? 0.08 : 0.06} />
                          <stop offset="100%" stopColor="#0891b2" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
                      <XAxis
                        dataKey="name"
                        stroke={chartAxisStroke}
                        tickLine={false}
                        axisLine={{ stroke: chartAxisLine }}
                        interval={0}
                        minTickGap={periodGranularity === 'month' ? 2 : 8}
                        tickMargin={8}
                        angle={0}
                        textAnchor="middle"
                        height={periodGranularity === 'month' ? 56 : 52}
                        tick={periodChartTick}
                      />
                      {kpiDrillChartCategory ? (
                        <ReferenceLine
                          x={kpiDrillChartCategory}
                          stroke="#fbbf24"
                          strokeDasharray="4 4"
                          strokeOpacity={0.9}
                        />
                      ) : periodGranularity === 'day' && selectedDayChartCategory ? (
                        <ReferenceLine
                          x={selectedDayChartCategory}
                          stroke="#22d3ee"
                          strokeDasharray="4 4"
                          strokeOpacity={0.85}
                        />
                      ) : null}
                      <YAxis
                        width={44}
                        stroke={chartAxisStroke}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatChartYAxisTick}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartTooltipBg,
                          border: `1px solid ${chartTooltipBorder}`,
                          borderRadius: '12px',
                          color: chartTooltipColor,
                          fontSize: '12px',
                          boxShadow: isDark
                            ? '0 10px 30px rgba(0,0,0,0.45)'
                            : '0 10px 30px rgba(15,23,42,0.12)',
                          padding: '10px 12px',
                        }}
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.fullLabel != null
                            ? String(payload[0].payload.fullLabel)
                            : ''
                        }
                        formatter={(value: number, _name: string, item: { payload?: { transacciones?: number } }) => {
                          const n = item?.payload?.transacciones;
                          if (typeof n === 'number') {
                            const suf = n === 1 ? '1 cobro' : `${n} cobros`;
                            return [`${formatMoney(value)} · ${suf}`, 'Cobrado del día'];
                          }
                          return [formatMoney(value), 'Cobrado'];
                        }}
                        cursor={{
                          stroke: chartCursorStroke,
                          strokeWidth: 1,
                          strokeDasharray: '4 4',
                          pointerEvents: 'none',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="ventas"
                        stroke={LINE_STROKE}
                        strokeWidth={2.5}
                        fill={`url(#${CHART_AREA_GRADIENT_ID})`}
                        isAnimationActive={false}
                        activeDot={(props: { cx?: number; cy?: number }) => {
                          const { cx, cy } = props;
                          if (cx == null || cy == null) return <g />;
                          const s = 9;
                          return (
                            <rect
                              pointerEvents="none"
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
                        dot={(props: {
                          cx?: number;
                          cy?: number;
                          payload?: {
                            isSelectedInChart?: boolean;
                            isKpiDrillDown?: boolean;
                            dayStartMs?: number;
                          };
                        }) => {
                          const { cx, cy, payload } = props;
                          if (cx == null || cy == null) return <g />;
                          const drill = Boolean(payload?.isKpiDrillDown);
                          const sel = Boolean(payload?.isSelectedInChart);
                          const s = drill ? 11 : sel ? 10 : 7;
                          const hitW = periodGranularity === 'month' ? 22 : 28;
                          const hitH = 120;
                          const selectDay = (e: React.SyntheticEvent) => {
                            e.stopPropagation();
                            const ms = payload?.dayStartMs;
                            if (typeof ms === 'number') {
                              setKpiDrillDownDayStart(startOfDay(new Date(ms)));
                            }
                          };
                          return (
                            <g style={{ cursor: 'pointer' }}>
                              <rect
                                x={cx - hitW / 2}
                                y={cy - hitH / 2}
                                width={hitW}
                                height={hitH}
                                rx={hitW / 2}
                                fill="transparent"
                                onPointerDown={selectDay}
                                onClick={selectDay}
                              />
                              <rect
                                pointerEvents="none"
                                x={cx - s / 2}
                                y={cy - s / 2}
                                width={s}
                                height={s}
                                rx={drill || sel ? 2 : 1}
                                fill={drill ? '#fef3c7' : sel ? '#cffafe' : LINE_DOT_FILL}
                                stroke={drill ? '#f59e0b' : sel ? '#22d3ee' : LINE_DOT_STROKE}
                                strokeWidth={drill ? 2.5 : sel ? 2.25 : 1.5}
                              />
                            </g>
                          );
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent className="flex w-full min-w-0 max-h-[92dvh] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 md:max-w-[min(92vw,36rem)]">
          <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 pb-3 pt-4 pr-14 text-left dark:border-slate-800/80">
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-500/25">
                <AlertTriangle className="h-4 w-4 text-white" />
              </span>
              Stock bajo
              {!stockLoading && lowStockProducts.length > 0 ? (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                    lowStockHasZero
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {lowStockProducts.length}
                </span>
              ) : null}
            </DialogTitle>
            <p className="text-sm font-normal text-slate-600 dark:text-slate-500">
              Productos en o por debajo del mínimo de existencia.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
            {stockLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <ListRowSkeleton key={i} />
                ))}
              </div>
            ) : lowStockProducts.length === 0 ? (
              <EmptyStateBlock
                icon={Package}
                title="Sin alertas de stock"
                hint="Todo el inventario está por encima del mínimo"
              />
            ) : (
              <div className="space-y-1.5">
                {lowStockProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-transparent bg-white/80 px-2.5 py-2 dark:bg-slate-800/40"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-transparent',
                          product.existencia === 0
                            ? 'bg-red-500 ring-red-500/30'
                            : 'bg-amber-400 ring-amber-400/30'
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                          {product.nombre}
                        </p>
                        <p className="text-[11px] text-slate-500">{product.sku}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          product.existencia === 0
                            ? 'text-red-500 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        )}
                      >
                        {product.existencia}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-[11px]"
                        onClick={goInventarioStock}
                      >
                        Ver en inventario
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800/80 sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setStockDialogOpen(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={goInventarioStock} className="gap-1.5">
              Abrir inventario
              <ChevronRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={todaySalesOpen}
        onOpenChange={(open) => {
          if (open) {
            setTodaySalesOpen(true);
          } else {
            closeTodaySalesDialog();
          }
        }}
      >
        <DialogContent className="flex w-full min-w-0 max-h-[92dvh] flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 md:max-w-[min(92vw,48rem)] lg:max-w-[min(92vw,56rem)]">
          <DialogHeader className="shrink-0 space-y-0 border-b border-slate-200 dark:border-slate-800/80 px-4 pb-3 pt-4 pr-14 text-left">
            {reprintSaleDetail || reprintAbonoDetail ? (
              <div className="flex items-start gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-slate-600 dark:text-slate-400"
                  aria-label="Volver al listado"
                  onClick={() => {
                    setReprintSaleDetail(null);
                    setReprintAbonoDetail(null);
                  }}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {reprintAbonoDetail
                      ? 'Abono de saldo pendiente'
                      : `Ticket ${reprintSaleDetail?.folio ?? ''}`}
                  </DialogTitle>
                  <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                    {reprintAbonoDetail
                      ? 'Cobro registrado el día del pago (cuenta en el corte).'
                      : 'Revisá el detalle antes de reimprimir.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <DialogTitle>Historial del día</DialogTitle>
                  <p className="mt-1 text-sm font-normal text-slate-600 dark:text-slate-500">
                    {reprintSearchMode
                      ? 'Buscá por folio, cliente, cajero o artículo en el historial reciente de tickets.'
                      : 'Ventas y abonos de saldo pendiente cobrados en la fecha elegida.'}
                  </p>
                  {reprintSearchMode ? (
                    <div className="relative mt-3 min-w-0">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="reprint-ticket-search"
                        type="search"
                        autoFocus
                        placeholder="Folio, cliente, cajero…"
                        value={reprintSearchQuery}
                        onChange={(e) => setReprintSearchQuery(e.target.value)}
                        className="h-9 w-full border-slate-300 bg-white pl-9 dark:border-slate-600 dark:bg-slate-900"
                      />
                    </div>
                  ) : (
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
                          className="h-9 w-auto min-w-[10.5rem] flex-1 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900 dark:[color-scheme:dark] sm:flex-initial"
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
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant={reprintSearchMode ? 'secondary' : 'ghost'}
                    size="icon"
                    className={cn(
                      'text-slate-600 dark:text-slate-400',
                      reprintSearchMode
                        ? 'bg-cyan-500/15 text-cyan-700 hover:bg-cyan-500/25 dark:text-cyan-300'
                        : 'hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-cyan-400'
                    )}
                    title={reprintSearchMode ? 'Volver al listado por día' : 'Buscar en historial de tickets'}
                    aria-label={reprintSearchMode ? 'Volver al listado por día' : 'Buscar en historial de tickets'}
                    onClick={() => {
                      setReprintSearchMode((on) => !on);
                      setReprintSearchQuery('');
                    }}
                  >
                    <Search className="h-5 w-5" />
                  </Button>
                  {!reprintSearchMode ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800 hover:text-cyan-400"
                      title="Reporte de ventas del día (térmica)"
                      aria-label="Imprimir reporte térmico del día seleccionado"
                      disabled={
                        reprintSalesSorted.length === 0 && reprintAbonosDelDia.length === 0
                      }
                      onClick={() => {
                        printThermalDailySalesReport({
                          fechaLabel: formatInAppTimezone(reprintDayStart, {
                            dateStyle: 'full',
                            timeStyle: 'short',
                          }),
                          sucursalId: effectiveSucursalId,
                          ventas: reprintSalesSorted,
                          abonosCobros: reprintAbonosDelDia.length
                            ? reprintAbonosDelDia
                            : undefined,
                        });
                      }}
                    >
                      <Printer className="h-5 w-5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {reprintAbonoDetail ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
                  <p className="font-medium">Abono de saldo pendiente</p>
                  <p className="mt-1 text-xs opacity-80">
                    Este cobro suma al corte del día en que se pagó (efectivo o tarjeta).
                  </p>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Cliente</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {reprintAbonoDetail.clienteNombre?.trim() || 'Cliente'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Fecha de pago</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {formatInAppTimezone(reprintAbonoDetail.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Forma de pago</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {labelFormaPagoCaja(reprintAbonoDetail.formaPago)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Cajero</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {reprintAbonoDetail.usuarioNombre?.trim() || '—'}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-slate-600 dark:text-slate-500">Monto cobrado</dt>
                    <dd className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                      {formatMoney(reprintAbonoDetail.monto)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : reprintSaleDetail ? (
              <div className="space-y-4">
                <div
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-sm',
                    saleIsInvoiced(reprintSaleDetail)
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                      : 'border-slate-300/80 bg-slate-200/80 text-slate-800 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-200'
                  )}
                >
                  <p className="flex items-center gap-2 font-medium">
                    {saleIsInvoiced(reprintSaleDetail) ? (
                      <>
                        <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                        Facturada
                      </>
                    ) : (
                      <>
                        <FileQuestion className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                        Sin facturar
                      </>
                    )}
                  </p>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Cliente</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {nombreClienteVenta(reprintSaleDetail)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Fecha</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {formatInAppTimezone(saleFechaHistorial(reprintSaleDetail), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600 dark:text-slate-500">Estado</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {saleEstadoEtiqueta(reprintSaleDetail)}
                    </dd>
                  </div>
                  {reprintSaleDetail.usuarioNombre?.trim() ? (
                    <div>
                      <dt className="text-slate-600 dark:text-slate-500">Cajero</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">
                        {reprintSaleDetail.usuarioNombre.trim()}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
                    Artículos
                  </p>
                  <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200/80 bg-white/60 p-2.5 text-xs dark:border-slate-700/60 dark:bg-slate-900/40">
                    {(reprintSaleDetail.productos ?? []).length === 0 ? (
                      <li className="text-slate-600 dark:text-slate-500">Sin líneas registradas.</li>
                    ) : (
                      (reprintSaleDetail.productos ?? []).map((item) => (
                        <li
                          key={item.id}
                          className="flex justify-between gap-2 border-b border-slate-200/60 pb-1 last:border-0 last:pb-0 dark:border-slate-700/50"
                        >
                          <span className="min-w-0 truncate">{lineaDescripcion(item)}</span>
                          <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-300">
                            ×{item.cantidad} · {formatMoney(Number(item.total) || 0)}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div className="space-y-1 rounded-lg border border-slate-200/80 bg-slate-200/50 px-3 py-2.5 text-sm dark:border-slate-700/60 dark:bg-slate-800/40">
                  <div className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatMoney(Number(reprintSaleDetail.subtotal) || 0)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <span>IVA</span>
                    <span className="tabular-nums">{formatMoney(Number(reprintSaleDetail.impuestos) || 0)}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-semibold text-cyan-600 dark:text-cyan-400">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMoney(reprintSaleDetail.total)}</span>
                  </div>
                  {reprintSaleDetail.cambio != null && reprintSaleDetail.cambio > 0 ? (
                    <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-400">
                      <span>Cambio</span>
                      <span className="tabular-nums">{formatMoney(reprintSaleDetail.cambio)}</span>
                    </div>
                  ) : null}
                </div>
                {(reprintSaleDetail.pagos ?? []).length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
                      Pagos
                    </p>
                    <ul className="space-y-1 text-sm">
                      {(reprintSaleDetail.pagos ?? []).map((p) => (
                        <li
                          key={p.id}
                          className="flex justify-between gap-2 text-slate-700 dark:text-slate-300"
                        >
                          <span>{labelFormaPago(p.formaPago)}</span>
                          <span className="tabular-nums">{formatMoney(Number(p.monto) || 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {reprintSaleDetail.notas?.trim() ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
                      Notas
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{reprintSaleDetail.notas.trim()}</p>
                  </div>
                ) : null}
                <Button
                  type="button"
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white sm:w-auto"
                  onClick={() => void printThermalTicketFromSale(reprintSaleDetail)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Reimprimir ticket
                </Button>
              </div>
            ) : reprintListLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/50" />
                ))}
              </div>
            ) : reprintSearchMode && !reprintSearchQuery.trim() ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-600 dark:text-slate-500">
                <Search className="mb-2 h-10 w-10 text-slate-600" />
                <p className="text-sm">Escribí folio, cliente, cajero o artículo para buscar</p>
              </div>
            ) : reprintListMovimientos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-600 dark:text-slate-500">
                <Receipt className="mb-2 h-10 w-10 text-slate-600" />
                <p className="text-sm">
                  {reprintSearchMode
                    ? 'No hay tickets que coincidan con la búsqueda'
                    : 'No hay ventas ni abonos en esta fecha'}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {reprintListMovimientos.map((mov) => {
                  if (mov.kind === 'abono') {
                    const a = mov.abono;
                    return (
                      <li
                        key={mov.id}
                        className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 dark:border-amber-500/30 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                            <Wallet className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                            <span className="truncate">Abono de saldo pendiente</span>
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-500">
                            {formatInAppTimezone(mov.at, {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            <span className="ml-2 text-amber-600 dark:text-amber-400">
                              · {labelFormaPagoCaja(a.formaPago)}
                            </span>
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-400">
                            <span className="font-medium text-slate-800 dark:text-slate-300">
                              {a.clienteNombre?.trim() || 'Cliente'}
                            </span>
                            {a.usuarioNombre?.trim() ? (
                              <span className="text-slate-600 dark:text-slate-500">
                                {' '}
                                · Cajero: {a.usuarioNombre.trim()}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm font-semibold tabular-nums text-cyan-500 dark:text-cyan-400">
                            {formatMoney(mov.monto)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-stretch gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReprintSaleDetail(null);
                              setReprintAbonoDetail(a);
                            }}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Ver detalle
                          </Button>
                        </div>
                      </li>
                    );
                  }

                  const sale = mov.sale;
                  return (
                    <li
                      key={mov.id}
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
                          {formatInAppTimezone(saleFechaHistorial(sale), {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
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
                        <p className="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-400">
                          <span className="font-medium text-slate-800 dark:text-slate-300">
                            {nombreClienteVenta(sale)}
                          </span>
                          {nombreCajeroVenta(sale) ? (
                            <span className="text-slate-600 dark:text-slate-500">
                              {' '}
                              · Cajero: {nombreCajeroVenta(sale)}
                            </span>
                          ) : null}
                        </p>
                        <p
                          className={cn(
                            'text-sm font-semibold tabular-nums text-cyan-400',
                            sale.estado === 'cancelada' &&
                              'text-slate-500 line-through decoration-slate-500/60'
                          )}
                        >
                          {formatMoney(sale.total)}
                          {sale.estado !== 'cancelada' &&
                          sale.estado !== 'pendiente' &&
                          Math.abs(mov.monto - (Number(sale.total) || 0)) > 0.02 ? (
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              · cobrado {formatMoney(mov.monto)}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-stretch gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReprintAbonoDetail(null);
                            setReprintSaleDetail(sale);
                          }}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          Ver detalle
                        </Button>
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
                  );
                })}
              </ul>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 dark:border-slate-800/80 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 sm:w-auto"
              onClick={closeTodaySalesDialog}
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
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p>
                  Ticket{' '}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                    {saleToCancel?.folio ?? '—'}
                  </span>
                </p>
                {saleToCancel ? (
                  <ul className="list-disc space-y-1.5 pl-5">
                    {parrafosAyudaCancelacionVentaAdmin(saleToCancel).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
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
