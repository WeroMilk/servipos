import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Printer, Tag, Trash2, Package, ArrowLeft, Settings2, ListFilter } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useAuthStore, useAppStore } from '@/stores';
import type { Product } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { printProductLabels, LABEL_FORMAT_OPTIONS, type LabelFormatPreset } from '@/lib/productLabelPrint';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

export function EtiquetasProductos() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { products, loading, error } = useProducts();

  const [queue, setQueue] = useState<QueueLine[]>([]);
  const [format, setFormat] = useState<LabelFormatPreset>('dk1209');
  const [addCopiesDefault, setAddCopiesDefault] = useState(1);
  const [familyPick, setFamilyPick] = useState<Record<string, boolean>>({});
  const [individualPick, setIndividualPick] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

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
    const n = addCopiesDefault < 1 ? 1 : Math.min(999, Math.floor(addCopiesDefault));
    setQueue((prev) => mergeIntoQueue(prev, activeProducts, n));
    addToast({ type: 'success', message: `Lista actualizada (${activeProducts.length} artículos).` });
  }, [activeProducts, addCopiesDefault, addToast]);

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
    const n = addCopiesDefault < 1 ? 1 : Math.min(999, Math.floor(addCopiesDefault));
    setQueue((prev) => mergeIntoQueue(prev, subset, n));
    setFamilyPick({});
    addToast({ type: 'success', message: `Añadidos ${subset.length} artículo(s) por familia.` });
  }, [activeProducts, familyPick, addCopiesDefault, addToast]);

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
    const n = addCopiesDefault < 1 ? 1 : Math.min(999, Math.floor(addCopiesDefault));
    setQueue((prev) => mergeIntoQueue(prev, subset, n));
    setIndividualPick({});
    addToast({ type: 'success', message: `Añadidos ${subset.length} artículo(s).` });
  }, [activeProducts, individualPick, addCopiesDefault, addToast]);

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
    const ok = printProductLabels(flat, format);
    if (!ok) {
      addToast({
        type: 'error',
        message: 'No se pudo abrir la ventana de impresión. Permita ventanas emergentes e intente de nuevo.',
      });
      return;
    }
    addToast({
      type: 'success',
      message: 'Cuando se abra el cuadro de impresión, elija la Brother QL-800 y el rollo correcto.',
    });
  }, [queue, format, addToast]);

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
        <div className="min-w-0 space-y-1">
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
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Brother QL-800 · Arme la lista y use <span className="font-medium">Imprimir</span>; en el diálogo del
            sistema elija la impresora y el rollo DK que corresponda al tamaño elegido.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden">
        <Card className="flex min-h-0 flex-1 flex-col border-slate-200/80 dark:border-slate-800/50 lg:min-h-0 lg:h-full">
          <CardHeader className="shrink-0 space-y-1 pb-3">
            <CardTitle className="text-base">Agregar a la lista</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Defina primero el tamaño de etiqueta y las copias por artículo. Luego elija si añade todo el
              catálogo activo, solo algunas familias o artículos puntuales. Si un producto ya estaba en la lista,
              se suman las copias.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-5">
            {/* Sección 1: opciones de etiqueta */}
            <section
              className={cn(
                'shrink-0 rounded-xl border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white p-4',
                'dark:border-slate-700/80 dark:from-slate-900/50 dark:to-slate-950/80'
              )}
            >
              <div className="mb-3 flex items-center gap-2 text-slate-800 dark:text-slate-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-400">
                  <Settings2 className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold leading-tight">Opciones de etiqueta</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Rollo Brother y copias al añadir</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="copias-def" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Copias por artículo al añadir
                  </Label>
                  <Input
                    id="copias-def"
                    type="number"
                    min={1}
                    max={999}
                    className="h-10 max-w-[7rem] tabular-nums"
                    value={addCopiesDefault}
                    onChange={(e) => setAddCopiesDefault(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rollo" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Tamaño de etiqueta (rollo)
                  </Label>
                  <select
                    id="rollo"
                    className={cn(
                      'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs',
                      'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
                    )}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as LabelFormatPreset)}
                  >
                    {LABEL_FORMAT_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-3 rounded-lg border border-slate-200/80 bg-white/70 px-3 py-2 text-[11px] leading-snug text-slate-600 dark:border-slate-700/80 dark:bg-slate-900/60 dark:text-slate-400">
                {LABEL_FORMAT_OPTIONS.find((x) => x.id === format)?.hint}
              </p>
            </section>

            {loading ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Cargando inventario…</p>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              /* Sección 2: modo de selección */
              <section
                className={cn(
                  'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/90',
                  'max-lg:min-h-[min(22rem,55vh)]',
                  'bg-white/40 dark:border-slate-700/80 dark:bg-slate-950/30'
                )}
              >
                <div className="shrink-0 border-b border-slate-200/80 px-4 pb-3 pt-4 dark:border-slate-800/80">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/12 text-violet-700 dark:text-violet-400">
                      <ListFilter className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold leading-tight">Qué incluir en la lista</h2>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Todos, por familia de producto o artículos sueltos
                      </p>
                    </div>
                  </div>
                </div>
                <Tabs
                  defaultValue="all"
                  className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden px-4 pb-3 pt-3 sm:px-4 sm:pb-4 max-lg:min-h-[min(18rem,42vh)]"
                >
                    <TabsList
                      className={cn(
                        'h-auto w-full shrink-0 flex-wrap justify-stretch gap-1 rounded-lg bg-slate-100/90 p-1',
                        'dark:bg-slate-900/80'
                      )}
                    >
                      <TabsTrigger
                        value="all"
                        className={cn(
                          'flex-1 rounded-md px-3 py-2 text-xs font-medium data-[state=active]:shadow-sm',
                          'data-[state=active]:bg-white data-[state=active]:text-slate-900',
                          'dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100'
                        )}
                      >
                        Todos
                      </TabsTrigger>
                      <TabsTrigger
                        value="family"
                        className={cn(
                          'flex-1 rounded-md px-3 py-2 text-xs font-medium data-[state=active]:shadow-sm',
                          'data-[state=active]:bg-white data-[state=active]:text-slate-900',
                          'dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100'
                        )}
                      >
                        Por familia
                      </TabsTrigger>
                      <TabsTrigger
                        value="pick"
                        className={cn(
                          'flex-1 rounded-md px-3 py-2 text-xs font-medium data-[state=active]:shadow-sm',
                          'data-[state=active]:bg-white data-[state=active]:text-slate-900',
                          'dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100'
                        )}
                      >
                        Individual
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent
                      value="all"
                      className="m-0 flex flex-shrink-0 flex-col gap-3 pt-1 outline-none"
                    >
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Hay <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{activeProducts.length}</span>{' '}
                        producto(s) activo(s); se añadirán a la lista con las copias indicadas arriba.
                      </p>
                      <Button type="button" size="default" className="w-full gap-2 sm:w-auto" onClick={addAll}>
                        <Package className="h-4 w-4" />
                        Añadir todos a la lista
                      </Button>
                    </TabsContent>

                    <TabsContent
                      value="family"
                      className="m-0 flex min-h-0 flex-1 flex-col gap-0 overflow-hidden pt-2 outline-none"
                    >
                      {categoriasEnUso.length === 0 ? (
                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          No hay categorías asignadas en productos activos. Asigne familia en inventario o use el
                          modo individual.
                        </p>
                      ) : (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                          <div className="shrink-0 sm:flex sm:justify-end">
                            <Button type="button" className="w-full gap-2 sm:w-auto" onClick={addByFamilies}>
                              <Package className="h-4 w-4" />
                              Añadir productos de familias marcadas
                            </Button>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-lg border border-slate-200/90 bg-white/60 px-1 py-1 dark:border-slate-800/80 dark:bg-slate-950/40 [scrollbar-gutter:stable]">
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
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent
                      value="pick"
                      className="m-0 flex min-h-0 flex-1 flex-col gap-0 overflow-hidden pt-2 outline-none"
                    >
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="shrink-0 space-y-1.5 pb-0.5">
                          <Label htmlFor="buscar-etiq" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Buscar artículo
                          </Label>
                          <Input
                            id="buscar-etiq"
                            placeholder="Nombre, SKU o código de barras…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-10 w-full"
                          />
                        </div>
                        <div className="shrink-0 sm:flex sm:justify-end">
                          <Button type="button" className="w-full gap-2 sm:w-auto" onClick={addIndividuals}>
                            <Package className="h-4 w-4" />
                            Añadir marcados a la lista
                          </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-lg border border-slate-200/90 bg-white/60 [scrollbar-gutter:stable] dark:border-slate-800/80 dark:bg-slate-950/40">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 z-[1] border-b border-slate-200/90 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                              <tr>
                                <th className="w-11 px-3 py-2.5">
                                  <span className="sr-only">Elegir</span>
                                </th>
                                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
                                  className="bg-white/50 transition-colors hover:bg-cyan-500/[0.04] dark:bg-transparent dark:hover:bg-slate-800/30"
                                >
                                  <td className="px-3 py-2 align-top">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 size-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500/40"
                                      checked={Boolean(individualPick[p.id])}
                                      onChange={(e) =>
                                        setIndividualPick((prev) => ({ ...prev, [p.id]: e.target.checked }))
                                      }
                                    />
                                  </td>
                                  <td className="max-w-[min(200px,40vw)] px-2 py-2">
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
                    </TabsContent>
                  </Tabs>
              </section>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col border-slate-200/80 dark:border-slate-800/50 lg:h-full lg:min-h-0 lg:overflow-hidden">
          <CardHeader className="shrink-0 space-y-1 pb-2">
            <CardTitle className="text-base">Lista para imprimir</CardTitle>
            <CardDescription className="text-xs">
              Ajuste cuántas etiquetas físicas por producto. Cada copia genera una página en el PDF de
              impresión.
            </CardDescription>
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
