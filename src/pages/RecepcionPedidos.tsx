import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Plus, PackageCheck, Search, Truck, X, Trash2 } from 'lucide-react';
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
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAppStore, useAuthStore, useInventoryListsStore } from '@/stores';
import { userHasPermission } from '@/lib/userPermissions';
import {
  buildProveedorNombrePorLinea,
  lookupProveedorCodigo,
  normalizeProveedorNombreGuardado,
  proveedorSelectItemLabel,
} from '@/lib/proveedoresCatalog';
import {
  PURCHASE_ORDER_ESTADO_LABELS,
  purchaseOrderPendienteLinea,
  purchaseOrderTotalFacturado,
  purchaseOrderTotalRecibido,
} from '@/lib/purchaseOrderLogic';
import type { Product, PurchaseOrder, PurchaseOrderEstado } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { productEsServicio } from '@/lib/productServicio';
import { getSucursalStateDocOnce } from '@/lib/firestore/stateDocsFirestore';

const ESTADO_BADGE: Record<PurchaseOrderEstado, string> = {
  esperando_mercancia: 'bg-amber-500/15 text-amber-900 border-amber-500/35 dark:text-amber-100',
  parcial: 'bg-cyan-500/15 text-cyan-900 border-cyan-500/35 dark:text-cyan-100',
  completado: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/35 dark:text-emerald-200',
  cancelada: 'bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-400',
};

type DraftLine = {
  lineId: string;
  product: Product;
  cantidadFacturada: number;
  precioUnitarioCompra: number;
  actualizarPrecioCompra: boolean;
};

type FiltroPedido = 'activos' | 'completados' | 'todos';

export function RecepcionPedidos() {
  const { user } = useAuthStore();
  const { addToast } = useAppStore();
  const { effectiveSucursalId } = useEffectiveSucursalId();
  const proveedoresLista = useInventoryListsStore((s) => s.proveedores);
  const setProveedoresInventario = useInventoryListsStore((s) => s.setProveedores);
  const { orders, loading, registerOrder, receiveOrderLines, products } = usePurchaseOrders();

  const [filtro, setFiltro] = useState<FiltroPedido>('activos');
  const [showCreate, setShowCreate] = useState(false);
  const [proveedor, setProveedor] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [notas, setNotas] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [receiveDraft, setReceiveDraft] = useState<
    Record<string, { cantidadRecibir: number; actualizarPrecioCompra: boolean }>
  >({});
  const [receiving, setReceiving] = useState(false);

  const canVer = userHasPermission(user, 'inventario:ver');
  const canEdit = userHasPermission(user, 'inventario:editar');

  const proveedorMap = useMemo(
    () => buildProveedorNombrePorLinea(proveedoresLista),
    [proveedoresLista]
  );
  const proveedorOptions = useMemo(
    () => [...proveedorMap.keys()].sort((a, b) => a.localeCompare(b, 'es')),
    [proveedorMap]
  );

  useEffect(() => {
    if (!effectiveSucursalId) return;
    void getSucursalStateDocOnce<{ proveedores?: string[] }>(
      effectiveSucursalId,
      'inventory_lists'
    ).then((doc) => {
      if (Array.isArray(doc?.proveedores) && doc.proveedores.length > 0) {
        setProveedoresInventario(doc.proveedores);
      }
    });
  }, [effectiveSucursalId, setProveedoresInventario]);

  const draftLinesTotal = useMemo(
    () =>
      Math.round(
        draftLines.reduce(
          (sum, l) => sum + l.cantidadFacturada * (Number(l.precioUnitarioCompra) || 0),
          0
        ) * 100
      ) / 100,
    [draftLines]
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.activo !== false &&
          !productEsServicio(p) &&
          (p.nombre.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.codigoBarras && p.codigoBarras.toLowerCase().includes(q)))
      )
      .slice(0, 25);
  }, [products, productSearch]);

  const displayOrders = useMemo(() => {
    return orders.filter((o) => {
      if (filtro === 'activos') return o.estado === 'esperando_mercancia' || o.estado === 'parcial';
      if (filtro === 'completados') return o.estado === 'completado' || o.estado === 'cancelada';
      return true;
    });
  }, [orders, filtro]);

  if (!canVer) return <Navigate to="/" replace />;

  const resetCreateForm = () => {
    setProveedor('');
    setNumeroFactura('');
    setNotas('');
    setProductSearch('');
    setDraftLines([]);
  };

  const addProductToDraft = (product: Product) => {
    if (draftLines.some((l) => l.product.id === product.id)) {
      setDraftLines((lines) =>
        lines.map((l) =>
          l.product.id === product.id
            ? { ...l, cantidadFacturada: l.cantidadFacturada + 1 }
            : l
        )
      );
    } else {
      setDraftLines((lines) => [
        ...lines,
        {
          lineId: crypto.randomUUID(),
          product,
          cantidadFacturada: 1,
          precioUnitarioCompra: product.precioCompra ?? 0,
          actualizarPrecioCompra: true,
        },
      ]);
    }
    setProductSearch('');
  };

  const handleRegister = async () => {
    const prov = normalizeProveedorNombreGuardado(proveedor);
    if (!prov) {
      addToast({ type: 'warning', message: 'Seleccione un proveedor.' });
      return;
    }
    if (draftLines.length === 0) {
      addToast({ type: 'warning', message: 'Agregue al menos un producto del pedido.' });
      return;
    }
    setSaving(true);
    try {
      await registerOrder({
        proveedor: prov,
        proveedorCodigo: lookupProveedorCodigo(prov, proveedoresLista),
        numeroFactura: numeroFactura.trim() || undefined,
        notas: notas.trim() || undefined,
        usuarioId: user?.id ?? 'system',
        usuarioNombre: user?.name?.trim() || user?.username?.trim() || undefined,
        productos: draftLines.map((l) => ({
          lineId: l.lineId,
          productId: l.product.id,
          nombre: l.product.nombre,
          sku: l.product.sku,
          cantidadFacturada: Math.max(1, l.cantidadFacturada),
          cantidadRecibida: 0,
          precioUnitarioCompra:
            l.precioUnitarioCompra > 0 ? l.precioUnitarioCompra : undefined,
          actualizarPrecioCompra: l.actualizarPrecioCompra,
        })),
      });
      addToast({
        type: 'success',
        message:
          'Pedido registrado. El inventario no cambió hasta que confirme la llegada de la mercancía.',
      });
      setShowCreate(false);
      resetCreateForm();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar el pedido',
      });
    } finally {
      setSaving(false);
    }
  };

  const openReceive = (order: PurchaseOrder) => {
    const draft: Record<string, { cantidadRecibir: number; actualizarPrecioCompra: boolean }> =
      {};
    for (const it of order.productos) {
      const pend = purchaseOrderPendienteLinea(it);
      draft[it.lineId] = {
        cantidadRecibir: pend,
        actualizarPrecioCompra: it.actualizarPrecioCompra !== false,
      };
    }
    setReceiveDraft(draft);
    setReceiveOrder(order);
  };

  const handleReceive = async () => {
    if (!receiveOrder) return;
    setReceiving(true);
    try {
      await receiveOrderLines(
        receiveOrder,
        receiveOrder.productos.map((it) => ({
          lineId: it.lineId,
          cantidadRecibir: receiveDraft[it.lineId]?.cantidadRecibir ?? 0,
          actualizarPrecioCompra: receiveDraft[it.lineId]?.actualizarPrecioCompra,
          precioUnitarioCompra: it.precioUnitarioCompra,
        }))
      );
      addToast({ type: 'success', message: 'Mercancía recibida; inventario actualizado.' });
      setReceiveOrder(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo registrar la recepción',
      });
    } finally {
      setReceiving(false);
    }
  };

  return (
    <PageShell
      title="Recepción de pedidos"
      subtitle="Registre la factura antes de que llegue la mercancía; confirme entrada total o parcial al recibir."
      actions={
        canEdit ? (
          <Button
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            onClick={() => {
              resetCreateForm();
              setShowCreate(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Registrar factura / pedido
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {(['activos', 'completados', 'todos'] as FiltroPedido[]).map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filtro === f ? 'default' : 'outline'}
            className={filtro === f ? 'bg-cyan-600 text-white' : ''}
            onClick={() => setFiltro(f)}
          >
            {f === 'activos' ? 'Pendientes' : f === 'completados' ? 'Cerrados' : 'Todos'}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" asChild>
          <Link to="/inventario">← Inventario</Link>
        </Button>
      </div>

      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-slate-500">Cargando pedidos…</p>
          ) : displayOrders.length === 0 ? (
            <p className="p-6 text-center text-slate-500">
              No hay pedidos en esta vista. Registre la factura cuando la tenga; al llegar la mercancía
              use «Recibir».
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-center">Progreso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayOrders.map((o) => {
                  const fac = purchaseOrderTotalFacturado(o.productos);
                  const rec = purchaseOrderTotalRecibido(o.productos);
                  const puedeRecibir =
                    canEdit &&
                    (o.estado === 'esperando_mercancia' || o.estado === 'parcial');
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-sm">{o.folio}</TableCell>
                      <TableCell>{o.proveedor}</TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {o.numeroFactura?.trim() || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                        {formatInAppTimezone(o.createdAt, { dateStyle: 'short' })}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {rec} / {fac}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('border', ESTADO_BADGE[o.estado])}>
                          {PURCHASE_ORDER_ESTADO_LABELS[o.estado]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {puedeRecibir ? (
                          <Button type="button" size="sm" onClick={() => openReceive(o)}>
                            <Truck className="mr-1 h-3 w-3" />
                            Recibir
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar factura (sin mover inventario)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Capture lo que trae la factura. El stock entrará cuando confirme la recepción al llegar el
            pedido (total o por partes).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select
                value={proveedor.trim() ? normalizeProveedorNombreGuardado(proveedor) : '__none__'}
                onValueChange={(v) => setProveedor(v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="h-10 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <SelectValue placeholder="Proveedor" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  hideScrollButtons
                  className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                >
                  <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                    Seleccione…
                  </SelectItem>
                  {proveedorOptions.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-900 dark:text-slate-100">
                      {proveedorSelectItemLabel(c, proveedorMap)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {proveedorOptions.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No hay proveedores configurados. Agréguelos en Configuración → Categorías y proveedores.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Número de factura</Label>
              <Input
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-2">
            <Label>Buscar producto</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                className="pl-9"
                placeholder="Nombre, SKU o código…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            {filteredProducts.length > 0 ? (
              <div className="max-h-36 overflow-auto rounded border border-slate-200 dark:border-slate-700">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-200/80 dark:hover:bg-slate-800"
                    onClick={() => addProductToDraft(p)}
                  >
                    <span className="truncate">{p.nombre}</span>
                    <span className="shrink-0 text-slate-500">{p.sku}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {draftLines.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium">Líneas del pedido</p>
              {draftLines.map((l) => (
                <div
                  key={l.lineId}
                  className="flex flex-wrap items-end gap-2 border-t border-slate-200/80 pt-2 first:border-0 first:pt-0 dark:border-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.product.nombre}</p>
                    <p className="text-xs text-slate-500">{l.product.sku}</p>
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs">Cant. factura</Label>
                    <Input
                      type="number"
                      min={1}
                      value={l.cantidadFacturada}
                      onChange={(e) => {
                        const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setDraftLines((lines) =>
                          lines.map((x) =>
                            x.lineId === l.lineId ? { ...x, cantidadFacturada: n } : x
                          )
                        );
                      }}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">P. compra s/IVA</Label>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={l.precioUnitarioCompra || ''}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value) || 0;
                        setDraftLines((lines) =>
                          lines.map((x) =>
                            x.lineId === l.lineId ? { ...x, precioUnitarioCompra: n } : x
                          )
                        );
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setDraftLines((lines) => lines.filter((x) => x.lineId !== l.lineId))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200/80 pt-2 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Total factura (s/IVA)
                </span>
                <span className="text-base font-semibold tabular-nums text-cyan-600 dark:text-cyan-400">
                  {formatMoney(draftLinesTotal)}
                </span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void handleRegister()}>
              {saving ? 'Guardando…' : 'Registrar pedido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receiveOrder != null} onOpenChange={(o) => !o && setReceiveOrder(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-cyan-500" />
              Recibir mercancía — {receiveOrder?.folio}
            </DialogTitle>
          </DialogHeader>
          {receiveOrder ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {receiveOrder.proveedor}
                {receiveOrder.numeroFactura ? ` · Factura ${receiveOrder.numeroFactura}` : ''}. Ajuste
                las cantidades que llegan ahora (puede ser una parte del pedido).
              </p>
              <div className="space-y-3">
                {receiveOrder.productos.map((it) => {
                  const pend = purchaseOrderPendienteLinea(it);
                  if (pend <= 0) return null;
                  const d = receiveDraft[it.lineId] ?? {
                    cantidadRecibir: 0,
                    actualizarPrecioCompra: true,
                  };
                  return (
                    <div
                      key={it.lineId}
                      className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {it.nombre ?? it.productId}
                      </p>
                      <p className="text-xs text-slate-500">
                        Facturado: {it.cantidadFacturada} · Ya recibido: {it.cantidadRecibida} · Pendiente:{' '}
                        {pend}
                        {it.precioUnitarioCompra != null && it.precioUnitarioCompra > 0
                          ? ` · P. compra: ${formatMoney(it.precioUnitarioCompra)}`
                          : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Recibir ahora</Label>
                          <Input
                            type="number"
                            min={0}
                            max={pend}
                            className="w-24"
                            value={d.cantidadRecibir}
                            onChange={(e) => {
                              const n = Math.min(
                                pend,
                                Math.max(0, parseInt(e.target.value, 10) || 0)
                              );
                              setReceiveDraft((prev) => ({
                                ...prev,
                                [it.lineId]: { ...d, cantidadRecibir: n },
                              }));
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setReceiveDraft((prev) => ({
                              ...prev,
                              [it.lineId]: { ...d, cantidadRecibir: pend },
                            }))
                          }
                        >
                          Todo pendiente
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setReceiveDraft((prev) => ({
                              ...prev,
                              [it.lineId]: { ...d, cantidadRecibir: 0 },
                            }))
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <input
                            type="checkbox"
                            checked={d.actualizarPrecioCompra}
                            onChange={(e) =>
                              setReceiveDraft((prev) => ({
                                ...prev,
                                [it.lineId]: {
                                  ...d,
                                  actualizarPrecioCompra: e.target.checked,
                                },
                              }))
                            }
                          />
                          Actualizar precio compra en catálogo
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setReceiveOrder(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="bg-cyan-600 text-white"
                  disabled={receiving}
                  onClick={() => void handleReceive()}
                >
                  {receiving ? 'Aplicando…' : 'Confirmar recepción'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
