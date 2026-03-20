import {
  TrendingUp,
  ShoppingCart,
  Package,
  Receipt,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTodaySales, useLowStockProducts } from '@/hooks';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const salesData = [
  { name: 'Lun', ventas: 4500 },
  { name: 'Mar', ventas: 6200 },
  { name: 'Mié', ventas: 5100 },
  { name: 'Jue', ventas: 7800 },
  { name: 'Vie', ventas: 9200 },
  { name: 'Sáb', ventas: 11500 },
  { name: 'Dom', ventas: 8900 },
];

const categoryData = [
  { name: 'Electrónica', value: 35, color: '#06b6d4' },
  { name: 'General', value: 25, color: '#3b82f6' },
  { name: 'Hogar', value: 20, color: '#8b5cf6' },
  { name: 'Otros', value: 20, color: '#64748b' },
];

/** Cursor al pasar sobre barras: fondo oscuro (no blanco). */
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

export function Dashboard() {
  const { sales, loading: salesLoading, totals } = useTodaySales();
  const { products: lowStockProducts, loading: stockLoading } = useLowStockProducts();

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden sm:gap-3">
      <header className="flex shrink-0 flex-col gap-1 border-b border-slate-800/40 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-100 sm:text-xl lg:text-2xl">Panel</h1>
          <p className="truncate text-xs text-slate-500 sm:text-sm">Resumen de hoy</p>
        </div>
        <p className="shrink-0 text-right text-[10px] text-slate-500 sm:text-sm">
          {new Date().toLocaleDateString('es-MX', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <StatCard
          title="Ventas hoy"
          value={`$${totals.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`}
          description={`${totals.count} transacciones`}
          icon={DollarSign}
          trend="up"
          trendValue="+12% frente a ayer"
          iconGradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
        />
        <StatCard
          title="Ticket prom."
          value={`$${totals.count > 0 ? (totals.total / totals.count).toFixed(2) : '0.00'}`}
          description="Por transacción"
          icon={ShoppingCart}
          trend="up"
          trendValue="+5% frente a ayer"
          iconGradient="bg-gradient-to-br from-cyan-500 to-cyan-600"
        />
        <StatCard
          title="Unidades"
          value={sales.reduce((sum, sale) => sum + sale.productos.length, 0).toString()}
          description="Líneas vendidas"
          icon={Package}
          trend="neutral"
          trendValue="Similar a ayer"
          iconGradient="bg-gradient-to-br from-blue-500 to-blue-600"
        />
        <StatCard
          title="Facturas"
          value={sales.filter((s) => s.facturaId).length.toString()}
          description="Del total ventas"
          icon={Receipt}
          trend="up"
          trendValue="+2 contra ayer"
          iconGradient="bg-gradient-to-br from-violet-500 to-violet-600"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden lg:flex-row lg:gap-3">
        <div className="flex min-h-0 min-w-0 flex-[1.4] flex-col gap-2 overflow-hidden lg:min-h-0">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
            <CardHeader className="shrink-0 space-y-0 py-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-100 sm:text-base">
                <TrendingUp className="h-4 w-4 shrink-0 text-cyan-400" />
                Ventas de la semana
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-2 pt-0 sm:p-3">
              <div className="min-h-[140px] flex-1 sm:min-h-[160px] lg:min-h-0">
                <ResponsiveContainer width="100%" height="100%">
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
                      formatter={(value: number) => [`$${value}`, 'Ventas']}
                      cursor={barCursor}
                    />
                    <Bar
                      dataKey="ventas"
                      fill="url(#colorGradient)"
                      radius={[3, 3, 0, 0]}
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
            <Card className="flex min-h-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center gap-2 text-xs text-slate-100 sm:text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  Stock bajo
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
              </CardContent>
            </Card>

            <Card className="flex min-h-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50">
              <CardHeader className="shrink-0 py-2">
                <CardTitle className="flex items-center gap-2 text-xs text-slate-100 sm:text-sm">
                  <ShoppingCart className="h-4 w-4 shrink-0 text-cyan-400" />
                  Ventas recientes
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
                    <p className="text-xs">Sin ventas hoy</p>
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
                          ${sale.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="flex min-h-[200px] w-full shrink-0 flex-col overflow-hidden border-slate-800/50 bg-slate-900/50 lg:min-h-0 lg:w-[min(100%,22rem)] xl:w-[min(100%,26rem)]">
          <CardHeader className="shrink-0 py-2">
            <CardTitle className="text-sm text-slate-100">Por categoría</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain p-2 pt-0 sm:p-3">
            <div className="min-h-[120px] shrink-0 sm:min-h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      color: '#f1f5f9',
                      fontSize: '12px',
                    }}
                    formatter={(value: number) => [`${value}%`, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="shrink-0 space-y-1">
              {categoryData.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="truncate text-slate-400">{cat.name}</span>
                  </div>
                  <span className="shrink-0 font-medium text-slate-300">{cat.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
