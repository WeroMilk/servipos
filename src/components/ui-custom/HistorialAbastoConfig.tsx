import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import { formatMoney, cn } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import type { Product } from '@/types';

type Props = {
  enabled: boolean;
};

/**
 * Entradas de inventario con proveedor y precio (si se capturaron al dar de alta mercancía).
 * La tabla solo se llena tras elegir un artículo en el buscador.
 */
export function HistorialAbastoConfig({ enabled }: Props) {
  const { products } = useProducts();
  const { movements, loading } = useInventoryMovementsHistory(enabled);
  const [query, setQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    const onDown = (e: PointerEvent) => {
      const root = wrapRef.current;
      if (!root?.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showPicker]);

  const productById = useMemo(() => {
    const m = new Map<string, (typeof products)[0]>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const pickerMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return products.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.codigoBarras !== undefined && String(p.codigoBarras).toLowerCase().includes(q))
    ).slice(0, 50);
  }, [products, query]);

  const entradas = useMemo(
    () => movements.filter((m) => m.tipo === 'entrada' || m.tipo === 'compra'),
    [movements]
  );

  const rows = useMemo(() => {
    if (!selectedProduct) return [];
    return entradas.filter((m) => m.productId === selectedProduct.id);
  }, [entradas, selectedProduct]);

  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    setQuery('');
    setShowPicker(false);
  };

  const clearSelection = () => {
    setSelectedProduct(null);
    setQuery('');
    setShowPicker(false);
  };

  const fieldClass =
    'h-11 border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800/50 text-base leading-normal text-slate-900 dark:text-slate-100 sm:h-8 sm:text-sm';

  return (
    <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50 bg-slate-50/90 dark:bg-slate-900/50">
      <CardHeader className="shrink-0 space-y-2 px-3 py-2 sm:px-4">
        <CardTitle className="text-base text-slate-900 dark:text-slate-100 sm:text-base">
          Historial de abasto por producto
        </CardTitle>
        <p className="text-sm font-normal text-slate-600 dark:text-slate-400 sm:text-xs">
          Muestra entradas de stock donde puede constar proveedor y precio unitario de compra (capturados en
          Inventario → Ajustar stock → Entrada). Busque por nombre, SKU o código y elija un artículo de la lista;
          hasta entonces no se muestra ningún movimiento.
        </p>

        <div className="space-y-1.5 pt-1">
          <Label htmlFor="abasto-product-search" className="text-sm text-slate-600 dark:text-slate-400 sm:text-xs">
            Artículo
          </Label>
          {selectedProduct ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-200/60 dark:bg-slate-800/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {selectedProduct.nombre}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 sm:text-[11px]">SKU {selectedProduct.sku}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-slate-300 dark:border-slate-600"
                onClick={clearSelection}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="relative" ref={wrapRef}>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
              <Input
                id="abasto-product-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowPicker(true);
                }}
                onFocus={() => setShowPicker(true)}
                placeholder="Escriba para buscar y elegir artículo…"
                autoComplete="off"
                className={cn(fieldClass, 'pl-9')}
              />
              {showPicker && query.trim().length > 0 && (
                <div
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(40dvh,14rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xl"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {pickerMatches.length === 0 ? (
                    <p className="p-3 text-center text-xs text-slate-600 dark:text-slate-400">
                      Ningún artículo coincide. Pruebe otro término.
                    </p>
                  ) : (
                    pickerMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectProduct(p)}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-slate-200/80 dark:border-slate-800/50 dark:hover:bg-slate-800/50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                            {p.nombre}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-500">SKU {p.sku}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0">
        <div className="min-h-0 max-h-[min(60dvh,28rem)] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800/70">
          {!selectedProduct ? (
            <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-500">
              Busque un artículo y selecciónelo en la lista desplegable para ver aquí las entradas de abasto de
              ese producto.
            </p>
          ) : loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-500">
              No hay entradas de abasto registradas para este artículo (o aún no se capturaron proveedor/precio
              en entradas anteriores).
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
                          <span className="block text-xs text-slate-500 dark:text-slate-500 sm:text-[11px]">SKU {p.sku}</span>
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
        <p className="text-xs text-slate-500 dark:text-slate-500 sm:text-[11px]">
          Hasta 500 movimientos más recientes de la sucursal. Las entradas antiguas pueden no tener proveedor ni
          precio.
        </p>
      </CardContent>
    </Card>
  );
}
