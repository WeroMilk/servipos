import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Printer,
  Tag,
  Trash2,
  Package,
  ArrowLeft,
  ListFilter,
  Pencil,
  CloudUpload,
  CloudDownload,
  ScanLine,
} from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useEffectiveSucursalId } from '@/hooks/useEffectiveSucursalId';
import { useAuthStore, useAppStore } from '@/stores';
import type { Product } from '@/types';
import { cn, formatMoney } from '@/lib/utils';
import { getProductPrecioPublicoRegular } from '@/lib/productListPricing';
import { printProductLabels } from '@/lib/productLabelPrint';
import { playBarcodeScannerFeedback } from '@/lib/barcodeScannerFeedback';
import { BarcodeCameraScanner } from '@/components/scanner/BarcodeCameraScanner';
import {
  clearEtiquetasPrintQueue,
  countEtiquetasInItems,
  hydrateEtiquetasPrintQueue,
  loadEtiquetasPrintQueue,
  queueLinesToPrintItems,
  saveEtiquetasPrintQueue,
  type EtiquetasPrintQueueDoc,
} from '@/lib/etiquetasPrintQueue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
type IncludeMode = 'all' | 'family' | 'pick' | 'paste';

type QueueLine = {
  key: string;
  productId: string;
  product: Product;
  copies: number;
  /** Precio manual para etiqueta (con IVA), sin tocar catálogo. */
  customLabelPrice?: number;
  /** Texto del nombre solo para impresión; si coincide con el catálogo no se guarda. */
  customLabelNombre?: string;
  /** `false` = no imprimir código de barras en la etiqueta. */
  labelShowBarcode?: boolean;
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

/** Une productos con copias distintas por línea (p. ej. pegado de SKUs con repeticiones). */
function mergeIntoQueueWithCopies(
  prev: QueueLine[],
  entries: { product: Product; copies: number }[]
): QueueLine[] {
  const map = new Map(prev.map((l) => [l.productId, { ...l }]));
  for (const { product, copies } of entries) {
    const add = Math.max(1, Math.floor(copies) || 1);
    const cur = map.get(product.id);
    if (cur) cur.copies += add;
    else
      map.set(product.id, {
        key: crypto.randomUUID(),
        productId: product.id,
        product,
        copies: add,
      });
  }
  return Array.from(map.values());
}

function parseSkuPasteTokens(raw: string): string[] {
  return raw
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findProductBySkuOrBarcode(
  products: readonly Product[],
  code: string
): Product | undefined {
  const key = code.trim().toLowerCase();
  if (!key) return undefined;
  const bySku = products.find((p) => p.sku.trim().toLowerCase() === key);
  if (bySku) return bySku;
  return products.find((p) => (p.codigoBarras ?? '').trim().toLowerCase() === key);
}

function expandForPrint(queue: QueueLine[]): Product[] {
  const out: Product[] = [];
  for (const line of queue) {
    for (let i = 0; i < line.copies; i++) {
      const extras: Record<string, unknown> = {};
      if (typeof line.customLabelPrice === 'number' && Number.isFinite(line.customLabelPrice)) {
        extras.__labelPrecioOverride = line.customLabelPrice;
      }
      const nameO = line.customLabelNombre?.trim();
      if (nameO && nameO !== line.product.nombre.trim()) {
        extras.__labelNombreOverride = nameO;
      }
      if (line.labelShowBarcode === false) {
        extras.__labelShowBarcode = false;
      }
      if (Object.keys(extras).length > 0) {
        out.push({ ...line.product, ...extras } as Product);
      } else {
        out.push(line.product);
      }
    }
  }
  return out;
}

function labelNombreMostrado(line: QueueLine): string {
  const o = line.customLabelNombre?.trim();
  return o || line.product.nombre;
}

function parseLabelPriceInput(raw: string): number | null {
  const normalized = raw.replace(/[^\d.,-]/g, '').replace(',', '.').trim();
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Formato fijo Brother 29 mm (cinta) × 60 mm (largo) — ver FORMATS.dk1201. */
const PRINT_LABEL_FORMAT = 'dk1201' as const;
const ADD_LIST_COPIES = 1;

export function EtiquetasProductos() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const { addToast } = useAppStore();
  const { products, loading, error } = useProducts();
  const { effectiveSucursalId } = useEffectiveSucursalId();

  const [queue, setQueue] = useState<QueueLine[]>([]);
  const [familyPick, setFamilyPick] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [skuPaste, setSkuPaste] = useState('');
  const [includeMode, setIncludeMode] = useState<IncludeMode>('all');
  const [labelEditProductId, setLabelEditProductId] = useState<string | null>(null);
  const [labelEditPriceInput, setLabelEditPriceInput] = useState('');
  const [labelEditNombreInput, setLabelEditNombreInput] = useState('');
  const [labelEditShowBarcode, setLabelEditShowBarcode] = useState(true);
  const [mobileScan, setMobileScan] = useState('');
  const [mobileScannerOpen, setMobileScannerOpen] = useState(false);
  const [pendingCloud, setPendingCloud] = useState<EtiquetasPrintQueueDoc | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingBusy, setPendingBusy] = useState(false);

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

  const refreshPendingCloud = useCallback(async () => {
    const sid = effectiveSucursalId?.trim();
    if (!sid) {
      setPendingCloud(null);
      return;
    }
    setPendingLoading(true);
    try {
      const doc = await loadEtiquetasPrintQueue(sid);
      setPendingCloud(doc);
    } catch (e) {
      console.warn('[Etiquetas] No se pudo cargar lista pendiente:', e);
      setPendingCloud(null);
    } finally {
      setPendingLoading(false);
    }
  }, [effectiveSucursalId]);

  useEffect(() => {
    void refreshPendingCloud();
  }, [refreshPendingCloud]);

  const pendingEtiquetaCount = pendingCloud ? countEtiquetasInItems(pendingCloud.items) : 0;

  const saveQueueToCloud = useCallback(async () => {
    const sid = effectiveSucursalId?.trim();
    if (!sid) {
      addToast({ type: 'warning', message: 'No hay sucursal activa para guardar la lista.' });
      return;
    }
    if (queue.length === 0) {
      addToast({ type: 'warning', message: 'Agregue artículos antes de guardar la lista pendiente.' });
      return;
    }
    const etiquetaCount = queue.reduce((s, l) => s + l.copies, 0);
    const items = queueLinesToPrintItems(queue);
    setPendingBusy(true);
    try {
      await saveEtiquetasPrintQueue(sid, items, user?.name || user?.username || user?.id);
      setQueue([]);
      await refreshPendingCloud();
      addToast({
        type: 'success',
        message: `Lista pendiente guardada (${etiquetaCount} etiqueta(s)). En la PC ábrala y pulse Imprimir.`,
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo guardar la lista pendiente.',
      });
    } finally {
      setPendingBusy(false);
    }
  }, [effectiveSucursalId, queue, user, addToast, refreshPendingCloud]);

  const loadPendingIntoQueue = useCallback(async () => {
    const sid = effectiveSucursalId?.trim();
    if (!sid || !pendingCloud?.items.length) {
      addToast({ type: 'warning', message: 'No hay lista pendiente en la nube.' });
      return;
    }
    setPendingBusy(true);
    try {
      const { lines, missingIds } = hydrateEtiquetasPrintQueue(pendingCloud.items, activeProducts);
      if (lines.length === 0) {
        addToast({
          type: 'error',
          message: 'Ningún artículo de la lista pendiente está en el catálogo activo.',
        });
        return;
      }
      setQueue((prev) => {
        const map = new Map(prev.map((l) => [l.productId, { ...l }]));
        for (const line of lines) {
          const cur = map.get(line.productId);
          if (cur) {
            cur.copies += line.copies;
            if (line.customLabelPrice != null) cur.customLabelPrice = line.customLabelPrice;
            if (line.customLabelNombre) cur.customLabelNombre = line.customLabelNombre;
            if (line.labelShowBarcode === false) cur.labelShowBarcode = false;
          } else {
            map.set(line.productId, line);
          }
        }
        return Array.from(map.values());
      });
      if (missingIds.length > 0) {
        addToast({
          type: 'warning',
          message: `Cargados ${lines.length} artículo(s). ${missingIds.length} ya no están en el catálogo.`,
        });
      } else {
        addToast({
          type: 'success',
          message: `Lista pendiente cargada (${lines.reduce((s, l) => s + l.copies, 0)} etiqueta(s)).`,
        });
      }
    } finally {
      setPendingBusy(false);
    }
  }, [effectiveSucursalId, pendingCloud, activeProducts, addToast]);

  const discardPendingCloud = useCallback(async () => {
    const sid = effectiveSucursalId?.trim();
    if (!sid) return;
    setPendingBusy(true);
    try {
      await clearEtiquetasPrintQueue(sid);
      setPendingCloud(null);
      addToast({ type: 'success', message: 'Lista pendiente descartada.' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo descartar la lista pendiente.',
      });
    } finally {
      setPendingBusy(false);
    }
  }, [effectiveSucursalId, addToast]);

  const addProductByCode = useCallback(
    (rawCode: string): boolean => {
      const code = rawCode.trim();
      if (!code) {
        addToast({ type: 'warning', message: 'Escanee o escriba un SKU / código de barras.' });
        return false;
      }
      const product = findProductBySkuOrBarcode(activeProducts, code);
      if (!product) {
        playBarcodeScannerFeedback('notFound');
        addToast({ type: 'error', message: `No se encontró: ${code}` });
        return false;
      }
      setQueue((prev) => mergeIntoQueue(prev, [product], ADD_LIST_COPIES));
      playBarcodeScannerFeedback('success');
      addToast({ type: 'success', message: `Añadido: ${product.nombre}` });
      return true;
    },
    [activeProducts, addToast]
  );

  const addProductFromMobileScan = useCallback(() => {
    if (addProductByCode(mobileScan)) setMobileScan('');
  }, [addProductByCode, mobileScan]);

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

  const addByPastedSkus = useCallback(() => {
    const tokens = parseSkuPasteTokens(skuPaste);
    if (tokens.length === 0) {
      addToast({
        type: 'warning',
        message: 'Pegue SKUs o códigos de barras (uno por línea).',
      });
      return;
    }

    const copiesByProductId = new Map<string, { product: Product; copies: number }>();
    const missing: string[] = [];
    const seenMissing = new Set<string>();

    for (const token of tokens) {
      const product = findProductBySkuOrBarcode(activeProducts, token);
      if (!product) {
        const key = token.toLowerCase();
        if (!seenMissing.has(key)) {
          seenMissing.add(key);
          missing.push(token);
        }
        continue;
      }
      const cur = copiesByProductId.get(product.id);
      if (cur) cur.copies += 1;
      else copiesByProductId.set(product.id, { product, copies: 1 });
    }

    const entries = [...copiesByProductId.values()];
    if (entries.length === 0) {
      addToast({
        type: 'error',
        message: `Ningún código coincidió con productos activos. Ej.: ${missing.slice(0, 5).join(', ')}`,
      });
      return;
    }

    setQueue((prev) => mergeIntoQueueWithCopies(prev, entries));
    const etiquetas = entries.reduce((s, e) => s + e.copies, 0);
    if (missing.length > 0) {
      addToast({
        type: 'warning',
        message: `Añadidos ${entries.length} artículo(s) (${etiquetas} etiqueta(s)). No encontrados: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`,
      });
    } else {
      addToast({
        type: 'success',
        message: `Añadidos ${entries.length} artículo(s) (${etiquetas} etiqueta(s)).`,
      });
    }
    setSkuPaste('');
  }, [activeProducts, skuPaste, addToast]);

  /** Modo individual: marcar fila añade/quita en la cola de impresión al momento. */
  const togglePickProductInQueue = useCallback((p: Product) => {
    setQueue((prev) => {
      if (prev.some((l) => l.productId === p.id)) {
        return prev.filter((l) => l.productId !== p.id);
      }
      return mergeIntoQueue(prev, [p], ADD_LIST_COPIES);
    });
  }, []);

  const setPickProductInQueue = useCallback((p: Product, inQueue: boolean) => {
    setQueue((prev) => {
      const exists = prev.some((l) => l.productId === p.id);
      if (inQueue && !exists) return mergeIntoQueue(prev, [p], ADD_LIST_COPIES);
      if (!inQueue && exists) return prev.filter((l) => l.productId !== p.id);
      return prev;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    const sid = effectiveSucursalId?.trim();
    if (sid && pendingCloud?.items.length) {
      void clearEtiquetasPrintQueue(sid)
        .then(() => setPendingCloud(null))
        .catch((e) => console.warn('[Etiquetas] No se pudo limpiar pendiente en nube:', e));
    }
    addToast({ type: 'success', message: 'Lista de etiquetas vaciada.' });
  }, [addToast, effectiveSucursalId, pendingCloud]);

  const updateCopies = useCallback((productId: string, copies: number) => {
    const c = Math.max(1, Math.min(999, Math.floor(copies) || 1));
    setQueue((prev) => prev.map((l) => (l.productId === productId ? { ...l, copies: c } : l)));
  }, []);

  const removeLine = useCallback((productId: string) => {
    setQueue((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const openLabelEdit = useCallback((line: QueueLine) => {
    const cur =
      typeof line.customLabelPrice === 'number' ? line.customLabelPrice : getProductPrecioPublicoRegular(line.product);
    setLabelEditProductId(line.productId);
    setLabelEditPriceInput(cur.toFixed(2));
    setLabelEditNombreInput(labelNombreMostrado(line));
    setLabelEditShowBarcode(line.labelShowBarcode !== false);
  }, []);

  const closeLabelEdit = useCallback(() => {
    setLabelEditProductId(null);
    setLabelEditPriceInput('');
    setLabelEditNombreInput('');
    setLabelEditShowBarcode(true);
  }, []);

  const saveLabelEdit = useCallback(() => {
    if (!labelEditProductId) return;
    const parsed = parseLabelPriceInput(labelEditPriceInput);
    if (parsed == null) {
      addToast({ type: 'warning', message: 'Ingrese un precio válido mayor o igual a 0.' });
      return;
    }
    const nombreTrim = labelEditNombreInput.trim();
    if (!nombreTrim) {
      addToast({ type: 'warning', message: 'El nombre en la etiqueta no puede quedar vacío.' });
      return;
    }
    setQueue((prev) =>
      prev.map((l) =>
        l.productId === labelEditProductId
          ? {
              ...l,
              customLabelPrice: parsed,
              customLabelNombre: nombreTrim === l.product.nombre.trim() ? undefined : nombreTrim,
              labelShowBarcode: labelEditShowBarcode ? undefined : false,
            }
          : l
      )
    );
    addToast({ type: 'success', message: 'Opciones de etiqueta actualizadas.' });
    closeLabelEdit();
  }, [labelEditProductId, labelEditPriceInput, labelEditNombreInput, labelEditShowBarcode, addToast, closeLabelEdit]);

  const resetLabelOverrides = useCallback(() => {
    if (!labelEditProductId) return;
    setQueue((prev) =>
      prev.map((l) =>
        l.productId === labelEditProductId
          ? { ...l, customLabelPrice: undefined, customLabelNombre: undefined, labelShowBarcode: undefined }
          : l
      )
    );
    addToast({ type: 'success', message: 'Etiqueta restaurada a los datos del catálogo.' });
    closeLabelEdit();
  }, [labelEditProductId, addToast, closeLabelEdit]);

  const handlePrint = useCallback(() => {
    if (queue.length === 0) {
      addToast({ type: 'warning', message: 'Agregue artículos a la lista antes de imprimir.' });
      return;
    }
    const flat = expandForPrint(queue);
    const ok = printProductLabels(flat, PRINT_LABEL_FORMAT);
    if (!ok) {
      addToast({
        type: 'error',
        message: 'No se pudo abrir la ventana de impresión. Permita ventanas emergentes e intente de nuevo.',
      });
      return;
    }
    closeLabelEdit();
    setQueue([]);
    const sid = effectiveSucursalId?.trim();
    if (sid) {
      void clearEtiquetasPrintQueue(sid)
        .then(() => setPendingCloud(null))
        .catch((e) => console.warn('[Etiquetas] No se pudo limpiar pendiente tras imprimir:', e));
    }
    addToast({
      type: 'success',
      message: 'Use el cuadro de impresión del sistema para finalizar. La lista quedó vacía.',
    });
  }, [queue, addToast, closeLabelEdit, effectiveSucursalId]);

  const editingLine = useMemo(
    () => (labelEditProductId ? queue.find((l) => l.productId === labelEditProductId) ?? null : null),
    [labelEditProductId, queue]
  );

  if (!hasPermission('inventario:ver')) {
    return <Navigate to="/" replace />;
  }

  const mobileUi = (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 pb-24 md:hidden">
      <div className="flex shrink-0 items-center gap-2">
        <Tag className="h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Lista de etiquetas</h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Escanee para reponer etiquetas · imprima en la PC.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <Input
          type="text"
          inputMode="search"
          enterKeyHint="done"
          placeholder="Buscar SKU o nombre…"
          value={mobileScan}
          onChange={(e) => setMobileScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addProductFromMobileScan();
            }
          }}
          className="h-11 flex-1"
          autoComplete="off"
        />
        <Button
          type="button"
          className="h-11 shrink-0 gap-1 px-3"
          onClick={() => setMobileScannerOpen(true)}
        >
          <ScanLine className="h-4 w-4" />
          Escanear
        </Button>
      </div>

      {!loading && !error && mobileScan.trim() ? (
        <div className="max-h-28 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800/50">
          {activeProducts
            .filter((p) => {
              const q = mobileScan.trim().toLowerCase();
              return (
                p.nombre.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                (p.codigoBarras ?? '').toLowerCase().includes(q)
              );
            })
            .slice(0, 20)
            .map((p) => {
              const inQueue = queue.some((l) => l.productId === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    togglePickProductInQueue(p);
                    setMobileScan('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    inQueue ? 'bg-brand/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{p.nombre}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">{p.sku}</span>
                </button>
              );
            })}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={queue.length === 0 || pendingBusy || !effectiveSucursalId}
          onClick={() => void saveQueueToCloud()}
        >
          <CloudUpload className="h-4 w-4" />
          {pendingBusy ? 'Guardando…' : 'Guardar lista pendiente'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={queue.length === 0} onClick={clearQueue}>
          <Trash2 className="h-4 w-4" />
          Vaciar
        </Button>
      </div>

      {pendingCloud && pendingEtiquetaCount > 0 ? (
        <p className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-100">
          Hay {pendingEtiquetaCount} etiqueta(s) pendientes en la nube
          {pendingCloud.updatedBy ? ` (últ. ${pendingCloud.updatedBy})` : ''}.
        </p>
      ) : null}

      <div className="min-h-[min(52dvh,24rem)] flex-1 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800/50">
        {queue.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            Lista vacía. Pulse <strong>Escanear</strong> o busque por SKU.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200/80 dark:divide-slate-800/50">
            {queue.map((line) => (
              <li key={line.key} className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{labelNombreMostrado(line)}</p>
                  <p className="text-[11px] text-slate-500">{line.product.sku}</p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  className="h-9 w-14"
                  value={line.copies}
                  onChange={(e) => updateCopies(line.productId, Number(e.target.value))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => removeLine(line.productId)}
                  aria-label="Quitar"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="shrink-0 text-center text-[11px] text-slate-500">
        Total:{' '}
        <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
          {queue.reduce((s, l) => s + l.copies, 0)}
        </span>{' '}
        etiqueta(s) · sin impresión en móvil
      </p>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={pendingBusy || !effectiveSucursalId || queue.length === 0}
          onClick={() => void saveQueueToCloud()}
        >
          <CloudUpload className="h-4 w-4" />
          Guardar pendiente
        </Button>
      </div>

      {pendingLoading ? (
        <p className="text-xs text-slate-500">Buscando lista pendiente…</p>
      ) : pendingCloud && pendingEtiquetaCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-950/30">
          <p className="min-w-0 flex-1 text-sm text-amber-950 dark:text-amber-50">
            Hay <strong className="tabular-nums">{pendingEtiquetaCount}</strong> etiqueta(s) pendientes
            ({pendingCloud.items.length} artículo(s))
            {pendingCloud.updatedBy ? ` · ${pendingCloud.updatedBy}` : ''}.
          </p>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={pendingBusy}
            onClick={() => void loadPendingIntoQueue()}
          >
            <CloudDownload className="h-4 w-4" />
            Cargar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingBusy}
            onClick={() => void discardPendingCloud()}
          >
            Descartar pendiente
          </Button>
        </div>
      ) : null}

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
                        Todos, por familia, individual o pegar lista de SKUs
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-3 px-3 pb-4 pt-3 sm:px-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                  <div
                    role="tablist"
                    aria-label="Cómo elegir productos"
                    className="grid min-w-0 grid-cols-2 gap-1 rounded-lg bg-slate-100/90 p-1 sm:grid-cols-4 dark:bg-slate-900/80"
                  >
                    {(
                      [
                        { id: 'all' as const, label: 'Todos' },
                        { id: 'family' as const, label: 'Por familia' },
                        { id: 'pick' as const, label: 'Individual' },
                        { id: 'paste' as const, label: 'Pegar SKUs' },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={includeMode === id}
                        className={cn(
                          'min-h-[2.75rem] w-full min-w-0 rounded-md px-2 py-2 text-center text-xs font-medium transition-[box-shadow,background-color]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
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
                                  className="size-4 shrink-0 rounded border-slate-400 accent-brand focus:ring-brand/40"
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
                            {filteredForPick.map((p) => {
                              const inPrintQueue = queue.some((l) => l.productId === p.id);
                              return (
                              <tr
                                key={p.id}
                                className="cursor-pointer bg-white/50 transition-colors hover:bg-brand/[0.04] dark:bg-transparent dark:hover:bg-slate-800/30"
                                onClick={() => togglePickProductInQueue(p)}
                              >
                                <td className="px-3 py-2 align-top">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 size-4 rounded border-slate-400 accent-brand focus:ring-brand/40"
                                    checked={inPrintQueue}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setPickProductInQueue(p, e.target.checked)}
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
                            );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {includeMode === 'paste' ? (
                    <div className="flex min-w-0 flex-col gap-3 pt-1 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Pegue SKUs o códigos de barras (uno por línea). Cada línea suma una etiqueta; si
                        repite un código, suma otra copia.
                      </p>
                      <Label
                        htmlFor="pegar-skus-etiq"
                        className="text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Lista de códigos
                      </Label>
                      <textarea
                        id="pegar-skus-etiq"
                        value={skuPaste}
                        onChange={(e) => setSkuPaste(e.target.value)}
                        placeholder={'80\n81\n82\n7503026414804\n…'}
                        spellCheck={false}
                        className={cn(
                          'min-h-[14rem] w-full min-w-0 flex-1 resize-y rounded-lg border border-slate-200/90 bg-white/80 px-3 py-2',
                          'font-mono text-xs leading-relaxed text-slate-900 placeholder:text-slate-400',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                          'dark:border-slate-800/80 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500'
                        )}
                      />
                      <Button
                        type="button"
                        size="default"
                        className="w-full gap-2 sm:w-auto sm:self-end"
                        onClick={addByPastedSkus}
                      >
                        <Package className="h-4 w-4" />
                        Añadir a la lista
                      </Button>
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
                        <p className="truncate font-medium leading-tight">{labelNombreMostrado(line)}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {line.product.sku} ·{' '}
                          {formatMoney(
                            typeof line.customLabelPrice === 'number'
                              ? line.customLabelPrice
                              : getProductPrecioPublicoRegular(line.product)
                          )}
                          {typeof line.customLabelPrice === 'number' ? ' · precio personalizado' : ''}
                          {line.customLabelNombre?.trim() &&
                          line.customLabelNombre.trim() !== line.product.nombre.trim()
                            ? ' · nombre en etiqueta'
                            : ''}
                          {line.labelShowBarcode === false ? ' · sin código de barras' : ''}
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
                          className="h-8 w-8 shrink-0 text-brand-to hover:text-brand-to dark:text-brand dark:hover:text-brand"
                          onClick={() => openLabelEdit(line)}
                          aria-label="Editar etiqueta"
                          title="Editar nombre, precio y código de barras de la etiqueta"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
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
      {mobileUi}
      {desktop}
      <Dialog open={mobileScannerOpen} onOpenChange={setMobileScannerOpen}>
        <DialogContent className="max-w-md gap-3 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-brand" />
              Escanear etiqueta
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Apunte al código de barras o SKU. Cada lectura se añade a la lista pendiente.
          </p>
          <BarcodeCameraScanner
            active={mobileScannerOpen}
            onScan={(code) => {
              addProductByCode(code);
            }}
            className="min-h-[16rem] w-full"
            elementId="etiquetas-mobile-scanner"
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setMobileScannerOpen(false)}>
              Cerrar cámara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={labelEditProductId != null}
        onOpenChange={(open) => {
          if (!open) closeLabelEdit();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar etiqueta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {editingLine?.product.nombre ?? 'Producto'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">SKU {editingLine?.product.sku ?? '—'}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-label-nombre">Nombre en la etiqueta</Label>
              <Input
                id="edit-label-nombre"
                placeholder="Texto que saldrá impreso"
                value={labelEditNombreInput}
                onChange={(e) => setLabelEditNombreInput(e.target.value)}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Solo cambia lo impreso; el nombre en inventario no se modifica.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/80 px-3 py-2.5 dark:border-slate-700/80">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="edit-label-barcode" className="text-sm font-medium leading-none">
                  Código de barras
                </Label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Incluir en la etiqueta (SKU o código del artículo)
                </p>
              </div>
              <Switch
                id="edit-label-barcode"
                checked={labelEditShowBarcode}
                onCheckedChange={setLabelEditShowBarcode}
                className="shrink-0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-label-price">Precio en etiqueta (con IVA)</Label>
              <Input
                id="edit-label-price"
                inputMode="decimal"
                placeholder="0.00"
                value={labelEditPriceInput}
                onChange={(e) => setLabelEditPriceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveLabelEdit();
                  }
                }}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Solo afecta la impresión; no modifica precios del catálogo.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={resetLabelOverrides} disabled={!editingLine}>
              Restablecer todo
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={closeLabelEdit}>
                Cancelar
              </Button>
              <Button type="button" onClick={saveLabelEdit}>
                Guardar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
