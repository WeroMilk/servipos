import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Eye, PackageMinus, Plus, Search, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGoodsExits } from '@/hooks/useGoodsExits';
import { useProductSearch } from '@/hooks/useProducts';
import { useAuthStore, useAppStore } from '@/stores';
import { userHasPermission } from '@/lib/userPermissions';
import {
  GOODS_EXIT_ESTADO_LABELS,
  GOODS_EXIT_MOTIVO_LABELS,
  goodsExitTotalPiezas,
} from '@/lib/goodsExitLogic';
import type { GoodsExit, GoodsExitMotivo, Product } from '@/types';
import { cn } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { productEsServicio } from '@/lib/productServicio';

type DraftLine = {
  lineId: string;
  product: Product;
  cantidad: number;
};

const MOTIVO_OPTIONS = Object.entries(GOODS_EXIT_MOTIVO_LABELS) as [GoodsExitMotivo, string][];

export function SalidasMercancia() {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const { exits, loading, registerExit } = useGoodsExits();
  const { results: searchResults, search } = useProductSearch({ maxResults: 24 });

  const [filtro, setFiltro] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [motivo, setMotivo] = useState<GoodsExitMotivo>('consumo_interno');
  const [motivoDetalle, setMotivoDetalle] = useState('');
  const [destino, setDestino] = useState('');
  const [notas, setNotas] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [detailExit, setDetailExit] = useState<GoodsExit | null>(null);

  const canVer = userHasPermission(user, 'inventario:ver');
  const canEdit = userHasPermission(user, 'inventario:editar');

  const filteredExits = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return exits;
    return exits.filter((ex) => {
      const hay = [
        ex.folio,
        GOODS_EXIT_MOTIVO_LABELS[ex.motivo],
        ex.motivoDetalle,
        ex.destino,
        ex.usuarioNombre,
        ex.notas,
        ...ex.productos.map((p) => `${p.nombre ?? ''} ${p.sku ?? ''}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [exits, filtro]);

  const resetCreateForm = () => {
    setMotivo('consumo_interno');
    setMotivoDetalle('');
    setDestino('');
    setNotas('');
    setProductSearch('');
    setDraftLines([]);
  };

  const handleProductSearch = (q: string) => {
    setProductSearch(q);
    search(q);
  };

  const addProductLine = (product: Product) => {
    if (productEsServicio(product)) {
      addToast({ type: 'warning', message: 'Los servicios no tienen inventario físico.' });
      return;
    }
    setDraftLines((lines) => {
      const idx = lines.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...lines];
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 };
        return next;
      }
      return [
        ...lines,
        {
          lineId: crypto.randomUUID(),
          product,
          cantidad: 1,
        },
      ];
    });
    setProductSearch('');
    search('');
  };

  const handleRegister = async () => {
    if (!canEdit) return;
    if (draftLines.length === 0) {
      addToast({ type: 'warning', message: 'Agregue al menos un producto.' });
      return;
    }
    setSaving(true);
    try {
      const created = await registerExit({
        motivo,
        motivoDetalle: motivoDetalle.trim() || undefined,
        destino: destino.trim() || undefined,
        notas: notas.trim() || undefined,
        usuarioId: user?.id ?? 'system',
        usuarioNombre: user?.name?.trim() || user?.username?.trim() || undefined,
        productos: draftLines.map((l) => ({
          lineId: l.lineId,
          productId: l.product.id,
          nombre: l.product.nombre,
          sku: l.product.sku,
          cantidad: Math.max(1, l.cantidad),
        })),
      });
      const piezas = goodsExitTotalPiezas(
        draftLines.map((l) => ({ ...l, productId: l.product.id, cantidad: l.cantidad, lineId: l.lineId }))
      );
      addToast({
        type: 'success',
        message: `Salida registrada (${created?.folio ?? 'ok'}). Inventario actualizado.`,
      });
      setShowCreate(false);
      resetCreateForm();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar la salida',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!canVer) {
    return <Navigate to="/inventario" replace />;
  }

  return (
    <PageShell
      title="Salidas de mercancía"
      subtitle="Registre bajas de inventario sin venta: merma, consumo interno, devolución a proveedor, etc."
      actions={
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/inventario">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Inventario
          </Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar folio, motivo, producto…"
              className="pl-9"
            />
          </div>
          {canEdit ? (
            <Button type="button" onClick={() => setShowCreate(true)} className="shrink-0">
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva salida
            </Button>
          ) : null}
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-slate-500">Cargando salidas…</p>
            ) : filteredExits.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <PackageMinus className="h-10 w-10 text-slate-400" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {filtro.trim() ? 'Sin resultados' : 'Aún no hay salidas registradas'}
                </p>
                <p className="max-w-md text-xs text-slate-500">
                  Use este módulo cuando retire mercancía del almacén sin ticket de venta.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Piezas</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="w-[80px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExits.map((ex) => (
                      <TableRow key={ex.id}>
                        <TableCell className="font-mono text-xs">{ex.folio}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatInAppTimezone(ex.createdAt, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm">{GOODS_EXIT_MOTIVO_LABELS[ex.motivo]}</span>
                            {ex.motivoDetalle ? (
                              <span className="text-xs text-slate-500">{ex.motivoDetalle}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {goodsExitTotalPiezas(ex.productos)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                          {ex.usuarioNombre ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Ver detalle"
                            onClick={() => setDetailExit(ex)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => !saving && setShowCreate(o)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva salida de mercancía</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Select value={motivo} onValueChange={(v) => setMotivo(v as GoodsExitMotivo)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVO_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="salida-destino">Destino / responsable (opcional)</Label>
                <Input
                  id="salida-destino"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  placeholder="Ej. taller, proveedor X…"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="salida-detalle">Detalle del motivo (opcional)</Label>
              <Input
                id="salida-detalle"
                value={motivoDetalle}
                onChange={(e) => setMotivoDetalle(e.target.value)}
                placeholder="Ej. empaque dañado en bodega"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="salida-notas">Notas internas (opcional)</Label>
              <Input
                id="salida-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Productos</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  placeholder="Buscar por nombre, SKU o código…"
                  className="pl-9"
                />
              </div>
              {productSearch.trim() && searchResults.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                  {searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => addProductLine(p)}
                      >
                        <span className="min-w-0 truncate">{p.nombre}</span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {p.sku} · exist. {p.existencia}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {draftLines.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-24 text-right">Exist.</TableHead>
                      <TableHead className="w-28">Cantidad</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftLines.map((line) => (
                      <TableRow key={line.lineId}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{line.product.nombre}</p>
                            <p className="text-xs text-slate-500">{line.product.sku}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {line.product.existencia}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            max={Math.max(1, line.product.existencia)}
                            value={line.cantidad}
                            onChange={(e) => {
                              const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                              setDraftLines((rows) =>
                                rows.map((r) =>
                                  r.lineId === line.lineId ? { ...r, cantidad: n } : r
                                )
                              );
                            }}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Quitar línea"
                            onClick={() =>
                              setDraftLines((rows) => rows.filter((r) => r.lineId !== line.lineId))
                            }
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Agregue productos desde el buscador.</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving || draftLines.length === 0} onClick={() => void handleRegister()}>
              {saving ? 'Registrando…' : 'Registrar salida'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailExit != null} onOpenChange={(o) => !o && setDetailExit(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {detailExit ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span>{detailExit.folio}</span>
                  <Badge variant="secondary">{GOODS_EXIT_ESTADO_LABELS[detailExit.estado]}</Badge>
                </DialogTitle>
              </DialogHeader>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Fecha</dt>
                  <dd>
                    {formatInAppTimezone(detailExit.createdAt, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Motivo</dt>
                  <dd>
                    {GOODS_EXIT_MOTIVO_LABELS[detailExit.motivo]}
                    {detailExit.motivoDetalle ? ` · ${detailExit.motivoDetalle}` : ''}
                  </dd>
                </div>
                {detailExit.destino ? (
                  <div>
                    <dt className="text-xs text-slate-500">Destino</dt>
                    <dd>{detailExit.destino}</dd>
                  </div>
                ) : null}
                {detailExit.usuarioNombre ? (
                  <div>
                    <dt className="text-xs text-slate-500">Registró</dt>
                    <dd>{detailExit.usuarioNombre}</dd>
                  </div>
                ) : null}
                {detailExit.notas ? (
                  <div>
                    <dt className="text-xs text-slate-500">Notas</dt>
                    <dd>{detailExit.notas}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-2 overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailExit.productos.map((it) => (
                      <TableRow key={it.lineId}>
                        <TableCell className="text-sm">
                          {it.nombre ?? it.productId}
                          {it.sku ? (
                            <span className={cn('ml-1 text-xs text-slate-500')}>{it.sku}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{it.cantidad}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
