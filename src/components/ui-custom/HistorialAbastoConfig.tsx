import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProducts } from '@/hooks/useProducts';
import { useInventoryMovementsHistory } from '@/hooks/useInventoryMovementsHistory';
import { formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { cn } from '@/lib/utils';

type Props = {
  enabled: boolean;
};

/**
 * Entradas de inventario con proveedor y precio (si se capturaron al dar de alta mercancía).
 */
export function HistorialAbastoConfig({ enabled }: Props) {
  const { products } = useProducts();
  const { movements, loading } = useInventoryMovementsHistory(enabled);
  const [query, setQuery] = useState('');

  const productById = useMemo(() => {
    const m = new Map<string, (typeof products)[0]>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const rows = useMemo(() => {
    const entradas = movements.filter((m) => m.tipo === 'entrada' || m.tipo === 'compra');
    const q = query.trim().toLowerCase();
    if (!q) return entradas;
    return entradas.filter((m) => {
      const p = productById.get(m.productId);
      const nombre = (p?.nombre ?? '').toLowerCase();
      const sku = (p?.sku ?? '').toLowerCase();
      const prov = (m.proveedor ?? '').toLowerCase();
      const mot = (m.motivo ?? '').toLowerCase();
      return (
        nombre.includes(q) || sku.includes(q) || prov.includes(q) || mot.includes(q) || m.productId.toLowerCase().includes(q)
      );
    });
  }, [movements, query, productById]);

  const fieldClass =
    'h-10 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 text-base text-slate-900 dark:text-slate-100 sm:h-8 sm:text-sm';

  return (
    <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
      <CardHeader className="shrink-0 space-y-2 px-3 py-2 sm:px-4">
        <CardTitle className="text-sm text-slate-900 dark:text-slate-100 sm:text-base">
          Historial de abasto por producto
        </CardTitle>
        <p className="text-xs font-normal text-slate-600 dark:text-slate-400">
          Muestra entradas de stock donde puede constar proveedor y precio unitario de compra (capturados en
          Inventario → Ajustar stock → Entrada). Busque por nombre de artículo, SKU o proveedor.
        </p>
        <div className="relative pt-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar artículo, SKU o proveedor…"
            className={cn(fieldClass, 'pl-9')}
          />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0">
        <div className="min-h-0 max-h-[min(60dvh,28rem)] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800/70">
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-500">
              {movements.length === 0
                ? 'No hay movimientos de inventario registrados aún.'
                : 'Ninguna entrada coincide con la búsqueda.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Fecha</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Artículo</TableHead>
                  <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Cantidad</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Proveedor</TableHead>
                  <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                    P. unit. compra
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                    Subtotal
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const p = productById.get(m.productId);
                  const nombre = p?.nombre?.trim() || `Producto (${m.productId.slice(0, 8)}…)`;
                  const when = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt);
                  const pu = m.precioUnitarioCompra;
                  const sub =
                    pu != null && Number.isFinite(pu) ? pu * (Number(m.cantidad) || 0) : null;
                  return (
                    <TableRow
                      key={m.id}
                      className="border-slate-200 dark:border-slate-800/80 hover:bg-slate-200/40 dark:hover:bg-slate-800/30"
                    >
                      <TableCell className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                        {formatInAppTimezone(when, { dateStyle: 'short', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {nombre}
                        </span>
                        {p?.sku ? (
                          <span className="block text-[11px] text-slate-500 dark:text-slate-500">SKU {p.sku}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-slate-800 dark:text-slate-200">
                        +{m.cantidad}
                      </TableCell>
                      <TableCell className="max-w-[10rem] text-sm text-slate-700 dark:text-slate-300">
                        {m.proveedor?.trim() || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm text-slate-800 dark:text-slate-200">
                        {pu != null && Number.isFinite(pu) ? formatMoney(pu) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm font-medium text-cyan-700 dark:text-cyan-400">
                        {sub != null ? formatMoney(sub) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-500">
          Hasta 500 movimientos más recientes de la sucursal. Las entradas antiguas pueden no tener proveedor ni
          precio.
        </p>
      </CardContent>
    </Card>
  );
}
