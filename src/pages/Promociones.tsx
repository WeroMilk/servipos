import { useCallback, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleDollarSign, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProducts, usePromotions } from '@/hooks';
import { useAppStore, useAuthStore } from '@/stores';
import type { Product, PromoKind, Promotion } from '@/types';
import { promoLabel, todayYmd } from '@/lib/promotions/applyPromotions';
import { cn, formatMoney } from '@/lib/utils';

/** Precio fijo (principal) + plantillas legacy solo al editar promos antiguas. */
type PromoTemplate =
  | 'fixed_price'
  | 'pct_20'
  | 'pct_50'
  | 'pct_custom'
  | 'nxm_2x1'
  | 'nxm_3x2'
  | 'nth_half';

type FormState = {
  nombre: string;
  template: PromoTemplate;
  /** Precio unitario sin IVA (texto del input). */
  fixedPrice: string;
  percent: string;
  fechaInicio: string;
  fechaFin: string;
  productIds: string[];
  activa: boolean;
};

function emptyForm(): FormState {
  const today = todayYmd();
  return {
    nombre: '',
    template: 'fixed_price',
    fixedPrice: '',
    percent: '20',
    fechaInicio: today,
    fechaFin: today,
    productIds: [],
    activa: true,
  };
}

function formFromPromotion(p: Promotion): FormState {
  let template: PromoTemplate = 'fixed_price';
  if (p.kind === 'fixed_price') {
    template = 'fixed_price';
  } else if (p.kind === 'percent') {
    const pct = Math.round(Number(p.percent) || 0);
    if (pct === 20) template = 'pct_20';
    else if (pct === 50) template = 'pct_50';
    else template = 'pct_custom';
  } else if (p.kind === 'nxm') {
    if (Number(p.buyQty) === 2 && Number(p.payQty) === 1) template = 'nxm_2x1';
    else if (Number(p.buyQty) === 3 && Number(p.payQty) === 2) template = 'nxm_3x2';
    else template = 'nxm_2x1';
  } else if (p.kind === 'nth_half') {
    template = 'nth_half';
  }
  const fixed = Number(p.fixedPrice);
  return {
    nombre: p.nombre,
    template,
    fixedPrice: Number.isFinite(fixed) && fixed >= 0 ? String(fixed) : '',
    percent: String(Math.round(Number(p.percent) || 20)),
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    productIds: [...p.productIds],
    activa: p.activa,
  };
}

function kindPayload(form: FormState): {
  kind: PromoKind;
  fixedPrice?: number;
  percent?: number;
  buyQty?: number;
  payQty?: number;
  everyNth?: number;
} {
  switch (form.template) {
    case 'fixed_price': {
      const v = Number(String(form.fixedPrice).replace(',', '.'));
      return {
        kind: 'fixed_price',
        fixedPrice: Math.round((Number.isFinite(v) ? Math.max(0, v) : 0) * 100) / 100,
      };
    }
    case 'pct_20':
      return { kind: 'percent', percent: 20 };
    case 'pct_50':
      return { kind: 'percent', percent: 50 };
    case 'pct_custom': {
      const pct = Math.min(99, Math.max(1, Math.round(Number(form.percent) || 0)));
      return { kind: 'percent', percent: pct };
    }
    case 'nxm_2x1':
      return { kind: 'nxm', buyQty: 2, payQty: 1 };
    case 'nxm_3x2':
      return { kind: 'nxm', buyQty: 3, payQty: 2 };
    case 'nth_half':
      return { kind: 'nth_half', everyNth: 2 };
  }
}

const LEGACY_TEMPLATE_OPTIONS: { id: PromoTemplate; label: string }[] = [
  { id: 'pct_20', label: '20%' },
  { id: 'pct_50', label: '50%' },
  { id: 'pct_custom', label: '% personalizado' },
  { id: 'nxm_2x1', label: '2x1' },
  { id: 'nxm_3x2', label: '3x2' },
  { id: 'nth_half', label: '2.º a mitad' },
];

export function Promociones() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { addToast } = useAppStore();
  const { products, loading: loadingProducts } = useProducts();
  const { promotions, loading, addPromotion, patchPromotion, removePromotion } = usePromotions();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = hasPermission('promociones:gestionar');
  const isFixedPriceForm = form.template === 'fixed_price';
  const isLegacyForm = !isFixedPriceForm;

  const activeProducts = useMemo(
    () => products.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [products]
  );

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

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.nombre);
    return m;
  }, [products]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setSearch('');
    setOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setEditingId(p.id);
    setForm(formFromPromotion(p));
    setSearch('');
    setOpen(true);
  };

  const toggleProduct = useCallback((p: Product, checked: boolean) => {
    setForm((prev) => {
      const set = new Set(prev.productIds);
      if (checked) set.add(p.id);
      else set.delete(p.id);
      return { ...prev, productIds: [...set] };
    });
  }, []);

  const save = async () => {
    if (!canManage) return;
    const nombre = form.nombre.trim();
    if (!nombre) {
      addToast({ type: 'warning', message: 'Indique un nombre para la promoción.' });
      return;
    }
    if (!form.fechaInicio || !form.fechaFin) {
      addToast({ type: 'warning', message: 'Indique fechas de inicio y fin.' });
      return;
    }
    if (form.fechaFin < form.fechaInicio) {
      addToast({ type: 'warning', message: 'La fecha fin no puede ser anterior al inicio.' });
      return;
    }
    if (form.productIds.length === 0) {
      addToast({ type: 'warning', message: 'Seleccione al menos un producto.' });
      return;
    }
    if (form.template === 'fixed_price') {
      const v = Number(String(form.fixedPrice).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) {
        addToast({ type: 'warning', message: 'Indique un precio fijo válido (≥ 0).' });
        return;
      }
    }
    if (form.template === 'pct_custom') {
      const pct = Math.round(Number(form.percent) || 0);
      if (pct < 1 || pct > 99) {
        addToast({ type: 'warning', message: 'El porcentaje debe estar entre 1 y 99.' });
        return;
      }
    }

    const kindPart = kindPayload(form);
    const payload = {
      nombre,
      ...kindPart,
      fechaInicio: form.fechaInicio,
      fechaFin: form.fechaFin,
      productIds: form.productIds,
      activa: form.activa,
    };

    try {
      setBusy(true);
      if (editingId) {
        await patchPromotion(editingId, payload);
        addToast({ type: 'success', message: 'Promoción actualizada.' });
      } else {
        await addPromotion(payload);
        addToast({ type: 'success', message: 'Promoción creada.' });
      }
      setOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar la promoción',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Promotion) => {
    if (!canManage) return;
    if (!window.confirm(`¿Eliminar la promoción «${p.nombre}»?`)) return;
    try {
      setBusy(true);
      await removePromotion(p.id);
      addToast({ type: 'success', message: 'Promoción eliminada.' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo eliminar',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return <Navigate to="/" replace />;
  }

  const fixedPreview = Number(String(form.fixedPrice).replace(',', '.'));

  return (
    <PageShell
      title="Promociones"
      subtitle="Defina un precio fijo para una lista de artículos; se aplica solo en el punto de venta."
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-1">
        <div className="flex shrink-0 justify-center">
          <Button type="button" onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva promoción
          </Button>
        </div>
        <Card className="border-slate-200/80 dark:border-slate-800/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4 text-brand" />
              Listado ({promotions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <p className="text-sm text-slate-500">Cargando…</p>
            ) : promotions.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no hay promociones en esta sucursal.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Precio / tipo</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead className="text-center">Productos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-[1%] text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promotions.map((p) => {
                    const ymd = todayYmd();
                    const vigente = p.activa && p.fechaInicio <= ymd && ymd <= p.fechaFin;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.nombre}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {promoLabel(p)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-600 dark:text-slate-400">
                          {p.fechaInicio} → {p.fechaFin}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {p.productIds.length}
                        </TableCell>
                        <TableCell>
                          {vigente ? (
                            <Badge className="bg-emerald-600/90 text-white hover:bg-emerald-600">
                              Vigente
                            </Badge>
                          ) : p.activa ? (
                            <Badge variant="outline">Fuera de fechas</Badge>
                          ) : (
                            <Badge variant="outline" className="opacity-70">
                              Inactiva
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(p)}
                              aria-label="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => void remove(p)}
                              aria-label="Eliminar"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-50 p-0 dark:border-slate-800 dark:bg-slate-900 sm:max-w-2xl">
          <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <DialogTitle>{editingId ? 'Editar promoción' : 'Nueva promoción'}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="promo-nombre">Nombre</Label>
              <Input
                id="promo-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej. Refacciones a $250"
              />
            </div>

            {isFixedPriceForm ? (
              <div className="space-y-1.5">
                <Label htmlFor="promo-fixed-price">Precio fijo (sin IVA)</Label>
                <div className="flex max-w-[14rem] items-center gap-2">
                  <span className="text-sm text-slate-500">$</span>
                  <Input
                    id="promo-fixed-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={form.fixedPrice}
                    onChange={(e) => setForm((f) => ({ ...f, fixedPrice: e.target.value }))}
                    placeholder="250.00"
                    aria-label="Precio fijo sin IVA"
                  />
                </div>
                <p className="text-[11px] leading-snug text-slate-500">
                  Ese importe es el unitario sin IVA en caja
                  {Number.isFinite(fixedPreview) && fixedPreview >= 0
                    ? ` (aprox. ${formatMoney(fixedPreview * 1.16)} con 16% IVA).`
                    : '.'}{' '}
                  Todos los artículos seleccionados saldrán a ese precio mientras la promo esté vigente.
                </p>
                {editingId && isLegacyForm === false ? (
                  <button
                    type="button"
                    className="text-[11px] text-slate-500 underline-offset-2 hover:underline"
                    onClick={() => setForm((f) => ({ ...f, template: 'pct_custom' }))}
                  >
                    Usar plantilla antigua (% / 2x1)…
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Tipo (legado)</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, template: 'fixed_price' }))}
                    className="rounded-lg border border-brand bg-brand/15 px-3 py-1.5 text-sm text-brand-to dark:text-brand"
                  >
                    Precio fijo
                  </button>
                  {LEGACY_TEMPLATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          template: opt.id,
                          percent:
                            opt.id === 'pct_20'
                              ? '20'
                              : opt.id === 'pct_50'
                                ? '50'
                                : f.percent,
                        }))
                      }
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                        form.template === opt.id
                          ? 'border-brand bg-brand/15 text-brand-to dark:text-brand'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.template === 'pct_custom' ? (
                  <div className="flex max-w-[10rem] items-center gap-2 pt-1">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={form.percent}
                      onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))}
                      aria-label="Porcentaje personalizado"
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                ) : null}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="promo-ini">Inicio</Label>
                <Input
                  id="promo-ini"
                  type="date"
                  value={form.fechaInicio}
                  onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-fin">Fin</Label>
                <Input
                  id="promo-fin"
                  type="date"
                  value={form.fechaFin}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Activa</p>
                <p className="text-xs text-slate-500">Si está apagada, no se aplica en caja.</p>
              </div>
              <Switch
                checked={form.activa}
                onCheckedChange={(v) => setForm((f) => ({ ...f, activa: v }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Label>Productos ({form.productIds.length})</Label>
                <p className="text-[11px] text-slate-500">
                  Un producto solo puede estar en una promoción.
                </p>
              </div>
              <Input
                placeholder="Buscar nombre, SKU o código…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {form.productIds.length > 0 ? (
                <p className="line-clamp-2 text-[11px] text-slate-500">
                  {form.productIds
                    .slice(0, 8)
                    .map((id) => productNameById.get(id) ?? id)
                    .join(' · ')}
                  {form.productIds.length > 8 ? '…' : ''}
                </p>
              ) : null}
              <div
                className={cn(
                  'min-h-[12rem] max-h-[min(40dvh,22rem)] overflow-auto rounded-lg border border-slate-200/90 bg-white/60',
                  'dark:border-slate-800/80 dark:bg-slate-950/40'
                )}
              >
                {loadingProducts ? (
                  <p className="p-3 text-sm text-slate-500">Cargando productos…</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                      <tr>
                        <th className="w-10 px-2 py-2" />
                        <th className="px-2 py-2 text-[10px] font-semibold uppercase text-slate-500">
                          Artículo
                        </th>
                        <th className="px-2 py-2 text-[10px] font-semibold uppercase text-slate-500">
                          SKU
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
                      {filteredForPick.map((p) => {
                        const checked = form.productIds.includes(p.id);
                        return (
                          <tr
                            key={p.id}
                            className="cursor-pointer hover:bg-brand/[0.04]"
                            onClick={() => toggleProduct(p, !checked)}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                className="size-4 rounded border-slate-400 accent-brand"
                                checked={checked}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => toggleProduct(p, e.target.checked)}
                              />
                            </td>
                            <td className="max-w-[14rem] px-2 py-1.5">
                              <span className="line-clamp-2 text-[13px] font-medium leading-snug">
                                {p.nombre}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-slate-600">
                              {p.sku}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
