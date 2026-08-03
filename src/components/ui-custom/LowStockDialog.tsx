import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  EyeOff,
  FileSpreadsheet,
  Package,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { downloadPedidoStockBajo } from '@/lib/inventoryExport';
import { buildProductSearchIndex, searchProductIndex } from '@/lib/productSearchIndex';
import { cn } from '@/lib/utils';
import {
  lowStockAlertSucursalKey,
  selectLowStockBucket,
  useAppStore,
  useLowStockAlertStore,
} from '@/stores';
import type { Product } from '@/types';

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
  icon: ElementType;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex min-h-[7rem] flex-1 flex-col items-center justify-center gap-2 px-3 py-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200/70 ring-1 ring-slate-300/50 dark:bg-slate-800/60 dark:ring-slate-700/50">
        <Icon className="h-6 w-6 text-slate-500 opacity-80 dark:text-slate-400" />
      </div>
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{title}</p>
      {hint ? (
        <p className="max-w-[14rem] text-[10px] leading-snug text-slate-500 dark:text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type LowStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  loading: boolean;
  sucursalId: string | null | undefined;
  sucursalNombre?: string;
  onOpenInventario: () => void;
};

export function LowStockDialog({
  open,
  onOpenChange,
  products,
  loading,
  sucursalId,
  sucursalNombre,
  onOpenInventario,
}: LowStockDialogProps) {
  const addToast = useAppStore((s) => s.addToast);
  const alertKey = lowStockAlertSucursalKey(sucursalId);
  const bucket = useLowStockAlertStore((s) => selectLowStockBucket(s, alertKey));
  const hideProduct = useLowStockAlertStore((s) => s.hideProduct);
  const markOrdered = useLowStockAlertStore((s) => s.markOrdered);
  const syncResolved = useLowStockAlertStore((s) => s.syncResolved);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const hiddenSet = useMemo(() => new Set(bucket.hiddenIds), [bucket.hiddenIds]);
  const orderedSet = useMemo(() => new Set(bucket.orderedIds), [bucket.orderedIds]);

  useEffect(() => {
    syncResolved(
      alertKey,
      products.map((p) => p.id)
    );
  }, [alertKey, products, syncResolved]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedIds(new Set());
    }
  }, [open]);

  const visibleProducts = useMemo(
    () => products.filter((p) => !hiddenSet.has(p.id)),
    [products, hiddenSet]
  );

  const searchIndex = useMemo(
    () => buildProductSearchIndex(visibleProducts),
    [visibleProducts]
  );

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return visibleProducts;
    return searchProductIndex(searchIndex, searchQuery);
  }, [visibleProducts, searchIndex, searchQuery]);

  const allFilteredSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.has(p.id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (filteredProducts.every((p) => next.has(p.id))) {
        for (const p of filteredProducts) next.delete(p.id);
      } else {
        for (const p of filteredProducts) next.add(p.id);
      }
      return next;
    });
  }, [filteredProducts]);

  const handleHide = useCallback(
    (product: Product) => {
      hideProduct(alertKey, product.id);
      setSelectedIds((prev) => {
        if (!prev.has(product.id)) return prev;
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
      addToast({
        type: 'info',
        message: `"${product.nombre}" oculto. Volverá a aparecer cuando se reabastezca y se agote de nuevo.`,
      });
    },
    [alertKey, hideProduct, addToast]
  );

  const handleExportPedido = useCallback(() => {
    const selected = visibleProducts.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) {
      addToast({ type: 'error', message: 'Selecciona al menos un artículo para pedir.' });
      return;
    }
    try {
      downloadPedidoStockBajo({
        products: selected,
        sucursalNombre,
      });
      markOrdered(
        alertKey,
        selected.map((p) => p.id)
      );
      setSelectedIds(new Set());
      addToast({
        type: 'success',
        message: `Pedido CSV descargado (${selected.length}). Marcados como pedidos; al ingresarlos al inventario saldrán de stock bajo.`,
      });
    } catch (e) {
      console.error(e);
      addToast({ type: 'error', message: 'No se pudo generar el archivo de pedido.' });
    }
  }, [visibleProducts, selectedIds, sucursalNombre, markOrdered, alertKey, addToast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-full min-w-0 max-h-[92dvh] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-100 p-0 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 md:max-w-[min(92vw,36rem)]">
        <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 pb-3 pt-4 pr-14 text-left dark:border-slate-800/80">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-500/25">
              <AlertTriangle className="h-4 w-4 text-white" />
            </span>
            Stock bajo
            {!loading && visibleProducts.length > 0 ? (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                  visibleProducts.some((p) => p.existencia === 0)
                    ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                )}
              >
                {visibleProducts.length}
              </span>
            ) : null}
          </DialogTitle>
          <p className="text-sm font-normal text-slate-600 dark:text-slate-500">
            Productos en o por debajo del mínimo de existencia.
          </p>
          {!loading && visibleProducts.length > 0 ? (
            <div className="relative pt-2">
              <Search
                className="pointer-events-none absolute bottom-[0.55rem] left-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre o SKU…"
                className="h-9 border-slate-200 bg-white pl-8 text-sm dark:border-slate-700 dark:bg-slate-950/60"
                aria-label="Buscar stock bajo"
              />
            </div>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <ListRowSkeleton key={i} />
              ))}
            </div>
          ) : visibleProducts.length === 0 ? (
            <EmptyStateBlock
              icon={Package}
              title="Sin alertas de stock"
              hint="Todo el inventario está por encima del mínimo"
            />
          ) : filteredProducts.length === 0 ? (
            <EmptyStateBlock
              icon={Search}
              title="Sin coincidencias"
              hint="Prueba otro nombre o SKU"
            />
          ) : (
            <div className="space-y-1.5">
              <label className="mb-1 flex cursor-pointer items-center gap-2 px-1 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-slate-400 accent-amber-600"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                />
                Seleccionar {searchQuery.trim() ? 'resultados' : 'todos'} ({filteredProducts.length})
              </label>
              {filteredProducts.map((product) => {
                const ordered = orderedSet.has(product.id);
                const selected = selectedIds.has(product.id);
                return (
                  <div
                    key={product.id}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2',
                      ordered
                        ? 'border-emerald-500/25 bg-emerald-500/5 dark:bg-emerald-500/10'
                        : 'border-transparent bg-white/80 dark:bg-slate-800/40'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0 rounded border-slate-400 accent-amber-600"
                        checked={selected}
                        onChange={() => toggleSelect(product.id)}
                        aria-label={`Seleccionar ${product.nombre}`}
                      />
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
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span>{product.sku}</span>
                          {ordered ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                              <BadgeCheck className="h-3 w-3" />
                              Pedido
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
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
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 px-0 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        title="Ocultar hasta que se reabastezca y se agote de nuevo"
                        aria-label={`Ocultar ${product.nombre}`}
                        onClick={() => handleHide(product)}
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-[11px]"
                        onClick={onOpenInventario}
                      >
                        Ver en inventario
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800/80 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedIds.size > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 border-emerald-600/40 text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-300"
                onClick={handleExportPedido}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Pedir ({selectedIds.size})
              </Button>
            ) : null}
            <Button type="button" onClick={onOpenInventario} className="gap-1.5">
              Abrir inventario
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Conteo visible (sin ocultos) para la tarjeta del panel. */
export function useVisibleLowStockCount(
  products: Product[],
  sucursalId: string | null | undefined
): { visible: Product[]; visibleCount: number; hasZero: boolean } {
  const alertKey = lowStockAlertSucursalKey(sucursalId);
  const bucket = useLowStockAlertStore((s) => selectLowStockBucket(s, alertKey));
  const syncResolved = useLowStockAlertStore((s) => s.syncResolved);

  useEffect(() => {
    syncResolved(
      alertKey,
      products.map((p) => p.id)
    );
  }, [alertKey, products, syncResolved]);

  return useMemo(() => {
    const hidden = new Set(bucket.hiddenIds);
    const visible = products.filter((p) => !hidden.has(p.id));
    return {
      visible,
      visibleCount: visible.length,
      hasZero: visible.some((p) => p.existencia === 0),
    };
  }, [products, bucket.hiddenIds]);
}
