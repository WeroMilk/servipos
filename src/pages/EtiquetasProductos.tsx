import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Printer, Tag, Trash2, Package, ArrowLeft } from 'lucide-react';
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
    <div className="hidden min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex">
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

      <div className="grid min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:grid-cols-[1fr_minmax(280px,380px)]">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50">
          <CardHeader className="shrink-0 space-y-1 pb-2">
            <CardTitle className="text-base">Agregar a la lista</CardTitle>
            <CardDescription className="text-xs">
              Todos los productos activos, por familia (categoría) o artículos sueltos. Las copias se suman si el
              artículo ya estaba en la lista.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="copias-def" className="text-xs">
                  Copias por artículo al añadir
                </Label>
                <Input
                  id="copias-def"
                  type="number"
                  min={1}
                  max={999}
                  className="h-9 w-24"
                  value={addCopiesDefault}
                  onChange={(e) => setAddCopiesDefault(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rollo" className="text-xs">
                  Tamaño de etiqueta (rollo)
                </Label>
                <select
                  id="rollo"
                  className={cn(
                    'h-9 w-full min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs',
                    'md:max-w-xs'
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
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{LABEL_FORMAT_OPTIONS.find((x) => x.id === format)?.hint}</p>

            {loading ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Cargando inventario…</p>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <Tabs defaultValue="all" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <TabsList className="h-9 w-full shrink-0 justify-start overflow-x-auto">
                  <TabsTrigger value="all" className="text-xs">
                    Todos
                  </TabsTrigger>
                  <TabsTrigger value="family" className="text-xs">
                    Por familia
                  </TabsTrigger>
                  <TabsTrigger value="pick" className="text-xs">
                    Individual
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="mt-3 flex-shrink-0 space-y-0">
                  <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
                    {activeProducts.length} producto(s) activo(s).
                  </p>
                  <Button type="button" size="sm" className="gap-1.5" onClick={addAll}>
                    <Package className="h-4 w-4" />
                    Añadir todos a la lista
                  </Button>
                </TabsContent>
                <TabsContent value="family" className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                  {categoriasEnUso.length === 0 ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      No hay categorías asignadas en productos activos. Asigne familia en inventario o use el modo
                      individual.
                    </p>
                  ) : (
                    <>
                      <div className="max-h-48 space-y-2 overflow-y-auto overscroll-y-contain rounded-md border border-slate-200/80 p-2 dark:border-slate-800/50">
                        {categoriasEnUso.map((cat) => (
                          <label
                            key={cat}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-100/80 dark:hover:bg-slate-800/40"
                          >
                            <input
                              type="checkbox"
                              className="rounded border-slate-400"
                              checked={Boolean(familyPick[cat])}
                              onChange={(e) =>
                                setFamilyPick((prev) => ({ ...prev, [cat]: e.target.checked }))
                              }
                            />
                            <span className="truncate">{cat}</span>
                          </label>
                        ))}
                      </div>
                      <Button type="button" size="sm" className="mt-3 w-fit gap-1.5" onClick={addByFamilies}>
                        <Package className="h-4 w-4" />
                        Añadir productos de familias marcadas
                      </Button>
                    </>
                  )}
                </TabsContent>
                <TabsContent value="pick" className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                  <Input
                    placeholder="Buscar por nombre, SKU o código de barras…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="mb-2 h-9"
                  />
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-md border border-slate-200/80 dark:border-slate-800/50">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100/95 dark:bg-slate-900/95">
                        <tr>
                          <th className="w-10 px-2 py-1.5">
                            <span className="sr-only">Elegir</span>
                          </th>
                          <th className="px-2 py-1.5">Artículo</th>
                          <th className="px-2 py-1.5">SKU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredForPick.map((p) => (
                          <tr
                            key={p.id}
                            className="border-t border-slate-200/60 dark:border-slate-800/50"
                          >
                            <td className="px-2 py-1 align-top">
                              <input
                                type="checkbox"
                                className="rounded border-slate-400"
                                checked={Boolean(individualPick[p.id])}
                                onChange={(e) =>
                                  setIndividualPick((prev) => ({ ...prev, [p.id]: e.target.checked }))
                                }
                              />
                            </td>
                            <td className="max-w-[200px] px-2 py-1">
                              <span className="line-clamp-2 font-medium">{p.nombre}</span>
                              {p.categoria?.trim() ? (
                                <span className="mt-0.5 block text-[10px] text-slate-500">{p.categoria}</span>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px]">{p.sku}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button type="button" size="sm" className="mt-3 w-fit gap-1.5" onClick={addIndividuals}>
                    <Package className="h-4 w-4" />
                    Añadir marcados a la lista
                  </Button>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden border-slate-200/80 dark:border-slate-800/50">
          <CardHeader className="shrink-0 space-y-1 pb-2">
            <CardTitle className="text-base">Lista para imprimir</CardTitle>
            <CardDescription className="text-xs">
              Ajuste cuántas etiquetas físicas por producto. Cada copia genera una página en el PDF de
              impresión.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap gap-2">
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {mobileBlock}
      {desktop}
    </div>
  );
}
