import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { useInventoryListsStore } from '@/stores';
import { formatProveedorHistorialLineaResuelto } from '@/lib/proveedoresCatalog';
import { formatMoney, cn } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import {
  isMovimientoCatalogoInventario,
  isMovimientoHistorialAbasto,
  isMovimientoLlegadaMercancia,
  matchesAbastoHistorialSearch,
} from '@/lib/inventoryAbasto';
import { tipoMovimientoLabel } from '@/lib/inventoryMovementLabels';
import type { InventoryMovement, Product } from '@/types';

const ABOOST_MOVEMENTS_LIMIT = 1500;
const ABOOST_DISPLAY_CAP = 400;

type FiltroAbasto = 'todos' | 'llegadas' | 'catalogo';

type Props = {
  enabled: boolean;
};

/**
 * Abasto: llegadas de mercancía (entradas con proveedor/precio compra) y cambios de catálogo
 * (motivo con descripción, precios, etc. al editar en Inventario).
 */
export function HistorialAbastoConfig({ enabled }: Props) {
  const { products } = useProducts();
  const { movements, loading } = useInventoryMovementsHistory(enabled, ABOOST_MOVEMENTS_LIMIT);
  const proveedoresLista = useInventoryListsStore((s) => s.proveedores);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<FiltroAbasto>('todos');

  const productById = useMemo(() => {
    const m = new Map<string, (typeof products)[0]>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const abastoBase = useMemo(() => movements.filter(isMovimientoHistorialAbasto), [movements]);

  const filtered = useMemo(() => {
    let list = abastoBase;
    if (filtro === 'llegadas') list = list.filter(isMovimientoLlegadaMercancia);
    else if (filtro === 'catalogo') list = list.filter((m) => isMovimientoCatalogoInventario(m.tipo));
    if (query.trim()) {
      list = list.filter((m) => matchesAbastoHistorialSearch(m, productById.get(m.productId), query));
    }
    return list;
  }, [abastoBase, filtro, query, productById]);

  const rows = useMemo(() => filtered.slice(0, ABOOST_DISPLAY_CAP), [filtered]);
  const truncated = filtered.length > ABOOST_DISPLAY_CAP;

  const fieldClass =
    'h-11 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 text-base leading-normal text-slate-900 dark:text-slate-100 sm:h-9 sm:text-sm';

  return (
    <Card
      className={cn(
        'flex w-full min-w-0 flex-col border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50',
        'max-xl:flex-none max-xl:overflow-visible',
        'xl:min-h-0 xl:flex-1 xl:overflow-hidden'
      )}
    >
      <CardHeader className="shrink-0 space-y-3 px-3 py-2 sm:px-4">
        <div>
          <CardTitle className="text-base text-slate-900 dark:text-slate-100 sm:text-base">
            Historial de abasto
          </CardTitle>
          <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400 sm:text-[11px]">
            Llegadas de mercancía (entradas con proveedor o precio de compra) y cambios al actualizar artículos en
            Inventario (descripción, precios, proveedor del catálogo, etc.). Busque por nombre, SKU, código de barras,
            proveedor o texto del detalle.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="abasto-global-search" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
            Buscar
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="abasto-global-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Artículo, SKU, código de barras, proveedor, detalle…"
              autoComplete="off"
              className={cn(fieldClass, 'pl-9')}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'todos' as const, label: 'Todo abasto' },
              { id: 'llegadas' as const, label: 'Solo llegadas' },
              { id: 'catalogo' as const, label: 'Cambios en catálogo' },
            ] as const
          ).map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={filtro === f.id ? 'default' : 'outline'}
              className={filtro === f.id ? 'bg-brand-from text-white hover:bg-brand-to' : ''}
              onClick={() => setFiltro(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-500">
          {loading
            ? 'Cargando…'
            : query.trim()
              ? `${filtered.length} coincidencia(s)`
              : `${abastoBase.length} registro(s) en abasto`}
          {truncated ? ` · mostrando los ${ABOOST_DISPLAY_CAP} más recientes` : ''}
          {!loading && movements.length >= ABOOST_MOVEMENTS_LIMIT
            ? ` · límite ${ABOOST_MOVEMENTS_LIMIT} movimientos más recientes`
            : ''}
        </p>
      </CardHeader>
      <CardContent
        className={cn(
          'space-y-2 p-3 pt-0 sm:p-4 sm:pt-0',
          'max-xl:overflow-visible',
          'xl:min-h-0 xl:flex-1 xl:overflow-hidden'
        )}
      >
        <div
          className={cn(
            'rounded-lg border border-slate-200 dark:border-slate-800/70',
            'max-xl:min-h-0 max-xl:overflow-visible',
            'xl:min-h-0 xl:max-h-[min(60dvh,32rem)] xl:overflow-auto xl:overscroll-y-contain xl:[-webkit-overflow-scrolling:touch]'
          )}
        >
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-500">
              {query.trim()
                ? 'Ningún registro coincide. Pruebe otro término o cambie el filtro.'
                : 'No hay llegadas ni cambios de catálogo registrados todavía.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Fecha</TableHead>
                  <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Tipo</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Artículo</TableHead>
                  <TableHead className="whitespace-nowrap text-slate-600 dark:text-slate-400">Cant.</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-400">Proveedor</TableHead>
                  <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                    P. unit. compra
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-slate-600 dark:text-slate-400">
                    Subtotal
                  </TableHead>
                  <TableHead className="min-w-[10rem] text-slate-600 dark:text-slate-400">Detalle / motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <AbastoHistorialRow
                    key={m.id}
                    mov={m}
                    product={productById.get(m.productId)}
                    proveedoresLista={proveedoresLista}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AbastoHistorialRow({
  mov,
  product,
  proveedoresLista,
}: {
  mov: InventoryMovement;
  product: Product | undefined;
  proveedoresLista: string[];
}) {
  const cat = isMovimientoCatalogoInventario(mov.tipo);
  const llegada = isMovimientoLlegadaMercancia(mov);
  const nombre =
    product?.nombre?.trim() || mov.nombreRegistro?.trim() || `Producto (${mov.productId.slice(0, 8)}…)`;
  const sku = product?.sku || mov.skuRegistro;
  const when = mov.createdAt instanceof Date ? mov.createdAt : new Date(mov.createdAt);
  const pu = mov.precioUnitarioCompra;
  const sub = pu != null && Number.isFinite(pu) && llegada ? pu * (Number(mov.cantidad) || 0) : null;
  const motivo = mov.motivo?.trim() || '—';
  const proveedorLinea = llegada
    ? formatProveedorHistorialLineaResuelto(mov.proveedor, mov.proveedorCodigo, proveedoresLista) ||
      product?.proveedor?.trim() ||
      ''
    : product?.proveedor?.trim() || '';

  return (
    <TableRow className="border-slate-200 dark:border-slate-800/80 hover:bg-slate-200/40 dark:hover:bg-slate-800/30">
      <TableCell className="whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
        {formatInAppTimezone(when, { dateStyle: 'short', timeStyle: 'short' })}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge
          variant="outline"
          className={cn(
            'border text-[10px] font-medium',
            cat
              ? 'border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-200'
              : 'border-brand/40 bg-brand/10 text-brand-to dark:text-brand'
          )}
        >
          {tipoMovimientoLabel(mov.tipo)}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[12rem]">
        <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{nombre}</span>
        {sku ? (
          <span className="block text-xs text-slate-500 dark:text-slate-500">
            SKU {sku}
            {product?.codigoBarras?.trim() ? ` · CB ${product.codigoBarras.trim()}` : ''}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-slate-800 dark:text-slate-200">
        {cat ? '—' : llegada ? `+${mov.cantidad}` : String(mov.cantidad)}
      </TableCell>
      <TableCell className="max-w-[10rem] text-sm text-slate-700 dark:text-slate-300">
        {proveedorLinea || '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm text-slate-800 dark:text-slate-200">
        {llegada && pu != null && Number.isFinite(pu) ? formatMoney(pu) : '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm font-medium text-brand-to dark:text-brand">
        {sub != null ? formatMoney(sub) : '—'}
      </TableCell>
      <TableCell className="max-w-[16rem] text-xs text-slate-800 dark:text-slate-200">
        <span
          className={cn(cat || motivo.length > 60 ? 'line-clamp-6 whitespace-pre-wrap' : 'line-clamp-3')}
          title={motivo !== '—' ? motivo : undefined}
        >
          {motivo}
        </span>
      </TableCell>
    </TableRow>
  );
}
