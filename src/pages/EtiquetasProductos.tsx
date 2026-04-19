import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Printer, Tag, Trash2, Package, ArrowLeft, ListFilter } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useAuthStore, useAppStore } from '@/stores';
import type { Product } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { printProductLabels } from '@/lib/productLabelPrint';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
type IncludeMode = 'all' | 'family' | 'pick';

type QueueLine = {
  key: string;
  productId: string;
  product: Product;
  copies: number;
};

function mergeIntoQueue(prev: QueueLine[], products: Product[], addCopies: number): QueueLine[] {
  const map = new Map(prev.map((l) => [l.productId, { ...l }]));
  for (const p of products) {
    const cur = map.get(p.id);
    if (cur) cur.copies += addCopies;
    else map.set(p.id, { key: crypto.randomUUID(), productId: p.id, product: p, copies: addCopies });
  }
  return Array.from(map.values());
}

function expandForPrint(queue: QueueLine[]): Product[] {
  const out: Product[] = [];
  for (const line of queue) {
    for (let i = 0; i < line.copies; i++) out.push(line.product);
  }
  return out;
}

/** Formato fijo Brother 29 mm (cinta) × 60 mm (largo) — ver FORMATS.dk1201. */
const PRINT_LABEL_FORMAT = 'dk1201' as const;
const ADD_LIST_COPIES = 1;

export function EtiquetasProductos() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { products, loading, error } = useProducts();

  const [queue, setQueue] = useState<QueueLine[]>([]);
  const [familyPick, setFamilyPick] = useState<Record<string, boolean>>({});
  const [individualPick, setIndividualPick] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [includeMode, setIncludeMode] = useState<IncludeMode>('all');

  const activeProducts = useMemo(
    () => products.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [products]
  );

  const categoriasEnUso = useMemo(() => {
    const s = new Set<string>();
    for (const p of activeProducts) {
      const c = p.categoria?.trim();
      if (c) s.add(c);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [activeProducts]);

  const filteredForPick = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter((p) => {
      const n = p.nombre.toLowerCase();
      const sku = p.sku.toLowerCase();
      const cb = (p.codigoBarras ?? '').toLowerCase();
      return n.includes(q) || sku.includes(q) || cb.includes(q);
    });
  }, [activeProducts, search]);

  const addAll = useCallback(() => {
    setQueue((prev) => mergeIntoQueue(prev, activeProducts, ADD_LIST_COPIES));
    addToast({ type: 'success', message: `Lista actualizada (${activeProducts.length} artículos).` });
  }, [activeProducts, addToast]);

  const addByFamilies = useCallback(() => {
    const families = Object.entries(familyPick)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (families.length === 0) {
      addToast({ type: 'warning', message: 'Seleccione al menos una familia.' });
      return;
    }
    const setF = new Set(families);
    const subset = activeProducts.filter((p) => {
      const c = p.categoria?.trim();
      return c && setF.has(c);
    });
    if (subset.length === 0) {
      addToast({ type: 'warning', message: 'No hay artículos en las familias elegidas.' });
      return;
    }
    setQueue((prev) => mergeIntoQueue(prev, subset, ADD_LIST_COPIES));
    setFamilyPick({});
    addToast({ type: 'success', message: `Añadidos ${subset.length} artículo(s) por familia.` });
  }, [activeProducts, familyPick, addToast]);

  const addIndividuals = useCallback(() => {
    const ids = Object.entries(individualPick)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) {
      addToast({ type: 'warning', message: 'Marque al menos un artículo.' });
      return;
    }
    const idSet = new Set(ids);
    const subset = activeProducts.filter((p) => idSet.has(p.id));
    setQueue((prev) => mergeIntoQueue(prev, subset, ADD_LIST_COPIES));
    setIndividualPick({});
    addToast({ type: 'success', message: `Añadidos ${subset.length} artículo(s).` });
  }, [activeProducts, individualPick, addToast]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    addToast({ type: 'success', message: 'Lista de etiquetas vaciada.' });
  }, [addToast]);

  const updateCopies = useCallback((productId: string, copies: number) => {
    const c = Math.max(1, Math.min(999, Math.floor(copies) || 1));
    setQueue((prev) => prev.map((l) => (l.productId === productId ? { ...l, copies: c } : l)));
  }, []);

  const removeLine = useCallback((productId: string) => {
    setQueue((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const handlePrint = useCallback(() => {
    if (queue.length === 0) {
      addToast({ type: 'warning', message: 'Agregue artículos a la lista antes de imprimir.' });
      return;
    }
    const flat = expandForPrint(queue);
    if (flat.length > 500) {
      addToast({
        type: 'warning',
        message: 'Demasiadas etiquetas en un solo lote. Reduzca cantidades o imprima en varias veces.',
      });
      return;
    }
    const ok = printProductLabels(flat, PRINT_LABEL_FORMAT);
    if (!ok) {
      addToast({
        type: 'error',
        message: 'No se pudo abrir la ventana de impresión. Permita ventanas emergentes e intente de nuevo.',
      });
      return;
    }
    addToast({
      type: 'success',
      message: 'Use el cuadro de impresión del sistema para finalizar.',
    });
  }, [queue, addToast]);

  if (!hasPermission('inventario:ver')) {
    return <Navigate to="/" replace />;
  }

  const mobileBlock = (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center md:hidden">
      <Tag className="h-14 w-14 text-slate-400" aria-hidden />
      <div className="max-w-sm space-y-2">
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Solo en escritorio</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          La preparación e impresión de etiquetas físicas está pensada para pantalla grande y el navegador en
          el equipo donde está la impresora Brother.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link to="/inventario">Ir al inventario</Link>
      </Button>
    </div>
  );

  const desktop = (
    <div className="hidden min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain md:flex md:min-h-0">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-800/50">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" asChild>
              <Link to="/inventario">
                <ArrowLeft className="h-4 w-4" />
                Inventario
              </Link>
            </Button>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Etiquetas de productos
            </h1>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden">
        <Card className="flex min-h-0 flex-1 flex-col border-slate-200/80 dark:border-slate-800/50 lg:min-h-0 lg:h-full">
          <CardHeader className="shrink-0 pb-3">
            <CardTitle className="text-base">Agregar a la lista</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-5">
            {loading ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Cargando inventario…</p>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              /* Sección 2: modo de selección (sin Tabs de Radix: evita altura 0 en flex) */
              <section
                className={cn(
                  'min-w-0 rounded-xl border border-slate-200/90 bg-white/40 dark:border-slate-700/80 dark:bg-slate-950/30',
                  'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'
                )}
              >
                <div className="shrink-0 border-b border-slate-200/80 px-3 pb-3 pt-3 sm:px-4 sm:pt-4 dark:border-slate-800/80">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-700 dark:text-violet-400">
                      <ListFilter className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold leading-tight">Qué incluir en la lista</h2>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Todos, por familia de producto o artículos sueltos
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-3 px-3 pb-4 pt-3 sm:px-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                  <div
                    role="tablist"
                    aria-label="Cómo elegir productos"
                    className="grid min-w-0 grid-cols-1 gap-1 rounded-lg bg-slate-100/90 p-1 sm:grid-cols-3 dark:bg-slate-900/80"
                  >
                    {(
                      [
                        { id: 'all' as const, label: 'Todos' },
                        { id: 'family' as const, label: 'Por familia' },
                        { id: 'pick' as const, label: 'Individual' },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={includeMode === id}
                        className={cn(
                          'min-h-[2.75rem] w-full min-w-0 rounded-md px-2 py-2 text-center text-xs font-medium transition-[box-shadow,background-color]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40',
                          includeMode === id
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                            : 'text-slate-600 hover:bg-slate-200/40 dark:text-slate-400 dark:hover:bg-slate-800/50'
                        )}
                        onClick={() => setIncludeMode(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {includeMode === 'all' ? (
                    <div className="flex flex-col gap-3 pt-1">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Hay{' '}
                        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                          {activeProducts.length}
                        </span>{' '}
                        producto(s) activo(s); se añadirán a la lista con las copias indicadas arriba.
                      </p>
                      <Button type="button" size="default" className="w-full gap-2 sm:w-auto" onClick={addAll}>
                        <Package className="h-4 w-4" />
                        Añadir todos a la lista
                      </Button>
                    </div>
                  ) : null}

                  {includeMode === 'family' ? (
                    <div className="flex min-w-0 flex-col gap-3 pt-1 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                      {categoriasEnUso.length === 0 ? (
                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          No hay categorías asignadas en productos activos. Asigne familia en inventario o use el
                          modo individual.
                        </p>
                      ) : (
                        <>
                          <Button
                            type="button"
                            className="w-full gap-2 sm:w-auto sm:self-end"
                            onClick={addByFamilies}
                          >
                            <Package className="h-4 w-4" />
                            Añadir productos de familias marcadas
                          </Button>
                          <div
                            className={cn(
                              'min-h-[12rem] w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain rounded-lg border border-slate-200/90 bg-white/60 px-1 py-1',
                              'max-h-[min(50dvh,28rem)] lg:max-h-none lg:min-h-0 lg:flex-1',
                              '[scrollbar-gutter:stable] dark:border-slate-800/80 dark:bg-slate-950/40'
                            )}
                          >
                            {categoriasEnUso.map((cat) => (
                              <label
                                key={cat}
                                className={cn(
                                  'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm',
                                  'transition-colors hover:bg-slate-100/90 dark:hover:bg-slate-800/50'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="size-4 shrink-0 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500/40"
                                  checked={Boolean(familyPick[cat])}
                                  onChange={(e) =>
                                    setFamilyPick((prev) => ({ ...prev, [cat]: e.target.checked }))
                                  }
                                />
                                <span className="min-w-0 flex-1 leading-snug text-slate-800 dark:text-slate-200">
                                  {cat}
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}

                  {includeMode === 'pick' ? (
                    <div className="flex min-w-0 flex-col gap-3 pt-1 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor="buscar-etiq"
                          className="text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Buscar artículo
                        </Label>
                        <Input
                          id="buscar-etiq"
                          placeholder="Nombre, SKU o código de barras…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="h-10 w-full min-w-0"
                        />
                      </div>
                      <Button
                        type="button"
                        className="w-full gap-2 sm:w-auto sm:self-end"
                        onClick={addIndividuals}
                      >
                        <Package className="h-4 w-4" />
                        Añadir marcados a la lista
                      </Button>
                      <div
                        className={cn(
                          'min-h-[14rem] w-full min-w-0 overflow-auto overscroll-y-contain rounded-lg border border-slate-200/90 bg-white/60',
                          'max-h-[min(55dvh,36rem)] lg:max-h-none lg:min-h-0 lg:flex-1',
                          '[scrollbar-gutter:stable] dark:border-slate-800/80 dark:bg-slate-950/40'
                        )}
                      >
                        <table className="w-full min-w-0 text-left text-xs">
                          <thead className="sticky top-0 z-[1] border-b border-slate-200/90 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                            <tr>
                              <th className="w-11 px-3 py-2.5">
                                <span className="sr-only">Elegir</span>
                              </th>
                              <th className="min-w-0 px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Artículo
                              </th>
                              <th className="whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                SKU
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
                            {filteredForPick.map((p) => (
                              <tr
                                key={p.id}
                                className="cursor-pointer bg-white/50 transition-colors hover:bg-cyan-500/[0.04] dark:bg-transparent dark:hover:bg-slate-800/30"
                                onClick={() =>
                                  setIndividualPick((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                                }
                              >
                                <td className="px-3 py-2 align-top">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 size-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500/40"
                                    checked={Boolean(individualPick[p.id])}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      setIndividualPick((prev) => ({ ...prev, [p.id]: e.target.checked }))
                                    }
                                  />
                                </td>
                                <td className="min-w-0 max-w-[min(220px,52vw)] px-2 py-2">
                                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900 dark:text-slate-100">
                                    {p.nombre}
                                  </span>
                                  {p.categoria?.trim() ? (
                                    <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                      {p.categoria}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                  {p.sku}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col border-slate-200/80 dark:border-slate-800/50 lg:h-full lg:min-h-0 lg:overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="text-base">Lista para imprimir</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="default" size="sm" className="gap-1.5" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={clearQueue}
                disabled={queue.length === 0}
              >
                <Trash2 className="h-4 w-4" />
                Vaciar lista
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Total:{' '}
              <span className="font-medium tabular-nums text-slate-600 dark:text-slate-300">
                {queue.reduce((s, l) => s + l.copies, 0)}
              </span>{' '}
              etiqueta(s) · {queue.length} artículo(s)
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-md border border-slate-200/80 dark:border-slate-800/50">
              {queue.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  La lista está vacía.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200/80 dark:divide-slate-800/50">
                  {queue.map((line) => (
                    <li
                      key={line.key}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium leading-tight">{line.product.nombre}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {line.product.sku} · {formatMoney(line.product.precioVenta)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label htmlFor={`q-${line.productId}`} className="sr-only">
                          Copias
                        </Label>
                        <Input
                          id={`q-${line.productId}`}
                          type="number"
                          min={1}
                          max={999}
                          className="h-8 w-16"
                          value={line.copies}
                          onChange={(e) => updateCopies(line.productId, Number(e.target.value))}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-slate-500"
                          onClick={() => removeLine(line.productId)}
                          aria-label="Quitar de la lista"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain">
      {mobileBlock}
      {desktop}
    </div>
  );
}
