import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useClientPriceListCatalog } from '@/hooks/useClientPriceListCatalog';
import type { ClientPriceListId } from '@/lib/clientPriceLists';
import { effectiveListaPreciosIncluyenIva } from '@/lib/catalogPricingFlags';
import { parsePrecioNumberFromFirestore } from '@/lib/precioListaNorm';
import {
  getProductUnitConIvaForClienteList,
  getProductUnitSinIvaForClienteList,
} from '@/lib/productListPricing';
import { cn, formatMoney } from '@/lib/utils';
import type { Product, PurchaseOrder } from '@/types';

type PrecioIvaMode = 'sin' | 'con';

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function precioSinIvaToConIva(sinIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  return roundMoney2(sinIva * (1 + imp / 100));
}

function precioConIvaToSinIva(conIva: number, impuestoPct: number): number {
  const imp = Number(impuestoPct) || 0;
  if (imp <= 0) return roundMoney2(conIva);
  return roundMoney2(conIva / (1 + imp / 100));
}

function precioSinIvaToStoredValue(
  sinIva: number,
  product: Product
): number {
  const imp = Number(product.impuesto) || 16;
  const storageIncluyeIva = effectiveListaPreciosIncluyenIva(product);
  if (storageIncluyeIva) return roundMoney2(sinIva * (1 + imp / 100));
  return roundMoney2(sinIva);
}

function listaPrecioDisplay(
  product: Product,
  listaId: ClientPriceListId,
  modoDisplayConIva: boolean
): string {
  const sinIva = getProductUnitSinIvaForClienteList(product, listaId);
  if (!Number.isFinite(sinIva) || sinIva <= 0) return '';
  const display = modoDisplayConIva
    ? getProductUnitConIvaForClienteList(product, listaId)
    : roundMoney2(sinIva);
  return roundMoney2(display).toFixed(2);
}

function convertPrecioStrForDisplayMode(
  precioStr: string,
  impuestoPct: number,
  fromConIva: boolean,
  toConIva: boolean
): string {
  const t = precioStr.trim();
  if (!t) return '';
  const n = parsePrecioNumberFromFirestore(t);
  if (!Number.isFinite(n) || n < 0) return precioStr;
  const sinIva = fromConIva ? precioConIvaToSinIva(n, impuestoPct) : roundMoney2(n);
  const conIva = fromConIva ? roundMoney2(n) : precioSinIvaToConIva(n, impuestoPct);
  const display = toConIva ? conIva : sinIva;
  if (!Number.isFinite(display) || display <= 0) return '';
  return roundMoney2(display).toFixed(2);
}

function PrecioIvaModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: PrecioIvaMode;
  onChange: (v: PrecioIvaMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Ver y capturar precios con IVA o sin IVA"
      className="inline-flex shrink-0 rounded-md border border-slate-300 bg-slate-200/80 p-0.5 dark:border-slate-600 dark:bg-slate-800/80"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('sin')}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'sin'
            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        )}
        aria-pressed={value === 'sin'}
      >
        Sin IVA
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('con')}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'con'
            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        )}
        aria-pressed={value === 'con'}
      >
        Con IVA
      </button>
    </div>
  );
}

type LineEdit = {
  listaId: ClientPriceListId;
  precioStr: string;
};

type ModificarPreciosPedidoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: PurchaseOrder[];
  products: Product[];
  editProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onSaved?: (message: string) => void;
  onError?: (message: string) => void;
};

export function ModificarPreciosPedidoDialog({
  open,
  onOpenChange,
  orders,
  products,
  editProduct,
  onSaved,
  onError,
}: ModificarPreciosPedidoDialogProps) {
  const priceListCatalog = useClientPriceListCatalog();
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [precioIvaMode, setPrecioIvaMode] = useState<PrecioIvaMode>('sin');
  const precioIvaModeRef = useRef<PrecioIvaMode>('sin');
  precioIvaModeRef.current = precioIvaMode;
  const [lineEdits, setLineEdits] = useState<Record<string, LineEdit>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [orders]
  );

  const selectedOrder = useMemo(
    () => sortedOrders.find((o) => o.id === selectedOrderId) ?? null,
    [sortedOrders, selectedOrderId]
  );

  const resetDialog = useCallback(() => {
    setSelectedOrderId('');
    setPrecioIvaMode('sin');
    setLineEdits({});
    setSavingLineId(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDialog();
      return;
    }
    if (sortedOrders.length === 1 && !selectedOrderId) {
      setSelectedOrderId(sortedOrders[0]!.id);
    }
  }, [open, resetDialog, sortedOrders, selectedOrderId]);

  useEffect(() => {
    if (!selectedOrder) {
      setLineEdits({});
      return;
    }
    const next: Record<string, LineEdit> = {};
    for (const line of selectedOrder.productos) {
      const product = productById.get(line.productId);
      next[line.lineId] = {
        listaId: 'regular',
        precioStr: product
          ? listaPrecioDisplay(product, 'regular', precioIvaModeRef.current === 'con')
          : '',
      };
    }
    setLineEdits(next);
  }, [selectedOrder, productById]);

  const handlePrecioIvaModeChange = (mode: PrecioIvaMode) => {
    if (mode === precioIvaMode) return;
    const fromConIva = precioIvaMode === 'con';
    const toConIva = mode === 'con';
    setPrecioIvaMode(mode);
    if (!selectedOrder) return;
    setLineEdits((prev) => {
      const next = { ...prev };
      for (const line of selectedOrder.productos) {
        const edit = prev[line.lineId];
        if (!edit) continue;
        const product = productById.get(line.productId);
        const imp = Number(product?.impuesto) || 16;
        next[line.lineId] = {
          ...edit,
          precioStr: convertPrecioStrForDisplayMode(edit.precioStr, imp, fromConIva, toConIva),
        };
      }
      return next;
    });
  };

  const handleListaChange = (lineId: string, product: Product | undefined, listaId: ClientPriceListId) => {
    setLineEdits((prev) => ({
      ...prev,
      [lineId]: {
        listaId,
        precioStr: product ? listaPrecioDisplay(product, listaId, precioIvaMode === 'con') : '',
      },
    }));
  };

  const handleSaveLine = async (
    lineId: string,
    productId: string,
    orderFolio: string
  ) => {
    const edit = lineEdits[lineId];
    if (!edit) return;
    const product = productById.get(productId);
    if (!product) {
      onError?.('Producto no encontrado en el catálogo.');
      return;
    }

    const raw = edit.precioStr.trim();
    if (raw === '') {
      onError?.('Indique un precio para guardar.');
      return;
    }
    const sinIva = parsePrecioNumberFromFirestore(raw);
    const imp = Number(product.impuesto) || 16;
    const sinIvaFinal =
      precioIvaMode === 'con' ? precioConIvaToSinIva(sinIva, imp) : roundMoney2(sinIva);
    if (!Number.isFinite(sinIvaFinal) || sinIvaFinal < 0) {
      onError?.('Precio inválido.');
      return;
    }

    setSavingLineId(lineId);
    try {
      const fresh = productById.get(productId) ?? product;
      const stored = precioSinIvaToStoredValue(sinIvaFinal, fresh);
      const mergedMap: Partial<Record<ClientPriceListId, number>> = {
        ...(fresh.preciosPorListaCliente ?? {}),
        [edit.listaId]: stored,
      };

      const updates: Partial<Product> = {
        preciosPorListaCliente: mergedMap as Product['preciosPorListaCliente'],
      };

      if (edit.listaId === 'regular') {
        updates.precioVenta = roundMoney2(sinIvaFinal);
      }

      await editProduct(productId, updates);
      onSaved?.(
        `Precio ${priceListCatalog.labels[edit.listaId] ?? edit.listaId} guardado (${fresh.sku || fresh.nombre}) · pedido ${orderFolio}`
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'No se pudo guardar el precio.');
    } finally {
      setSavingLineId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && savingLineId == null) onOpenChange(false);
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Modificar precios por pedido</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Elija el folio del pedido y actualice los precios de venta en el catálogo. El costo
            mostrado es el de la factura del pedido (sin IVA).
          </p>
          <PrecioIvaModeToggle
            value={precioIvaMode}
            onChange={handlePrecioIvaModeChange}
            disabled={savingLineId != null}
          />
        </div>
        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-500">
          Modo de captura: {precioIvaMode === 'con' ? 'con IVA' : 'sin IVA'}. Al guardar se
          convierte al formato del catálogo automáticamente.
        </p>

        <div className="space-y-2">
          <Label>Folio del pedido</Label>
          <Select
            value={selectedOrderId || '__none__'}
            onValueChange={(v) => setSelectedOrderId(v === '__none__' ? '' : v)}
          >
            <SelectTrigger className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800">
              <SelectValue placeholder="Seleccione un pedido…" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              hideScrollButtons
              className="z-[300] max-h-[min(50dvh,18rem)] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
            >
              <SelectItem value="__none__" className="text-slate-900 dark:text-slate-100">
                Seleccione…
              </SelectItem>
              {sortedOrders.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-slate-900 dark:text-slate-100">
                  {o.folio} · {o.proveedor}
                  {o.numeroFactura ? ` · Fact. ${o.numeroFactura}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedOrder ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Costo s/IVA</TableHead>
                  <TableHead>Lista</TableHead>
                  <TableHead className="min-w-[7rem]">
                    Precio {precioIvaMode === 'con' ? 'c/IVA' : 's/IVA'}
                  </TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedOrder.productos.map((line) => {
                  const product = productById.get(line.productId);
                  const edit = lineEdits[line.lineId] ?? {
                    listaId: 'regular' as ClientPriceListId,
                    precioStr: '',
                  };
                  const costo =
                    line.precioUnitarioCompra != null && line.precioUnitarioCompra > 0
                      ? line.precioUnitarioCompra
                      : product?.precioCompra;
                  const isSaving = savingLineId === line.lineId;

                  return (
                    <TableRow key={line.lineId}>
                      <TableCell className="font-mono text-xs">
                        {line.sku?.trim() || product?.sku || '—'}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm">
                        {line.nombre?.trim() || product?.nombre || line.productId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-slate-600 dark:text-slate-400">
                        {costo != null && costo > 0 ? formatMoney(costo) : '—'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={edit.listaId}
                          disabled={isSaving || !product}
                          onValueChange={(v) =>
                            handleListaChange(line.lineId, product, v as ClientPriceListId)
                          }
                        >
                          <SelectTrigger className="h-9 min-w-[8.5rem] border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent
                            position="popper"
                            hideScrollButtons
                            className="z-[300] border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                          >
                            {priceListCatalog.entries.map(({ id, label }) => (
                              <SelectItem key={id} value={id} className="text-slate-900 dark:text-slate-100">
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="—"
                          disabled={isSaving || !product}
                          value={edit.precioStr}
                          onChange={(e) =>
                            setLineEdits((prev) => ({
                              ...prev,
                              [line.lineId]: {
                                ...edit,
                                precioStr: e.target.value.replace(/[^\d.,]/g, ''),
                              },
                            }))
                          }
                          className="h-9 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isSaving || !product}
                          onClick={() =>
                            void handleSaveLine(line.lineId, line.productId, selectedOrder.folio)
                          }
                        >
                          <Save className="mr-1 h-3 w-3" />
                          {isSaving ? 'Guardando…' : 'Guardar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            Seleccione un folio para ver los productos del pedido.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={savingLineId != null}
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
