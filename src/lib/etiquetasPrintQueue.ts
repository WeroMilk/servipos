import {
  getSucursalStateDocOnce,
  saveSucursalStateDoc,
} from '@/lib/firestore/stateDocsFirestore';
import type { Product } from '@/types';

export const ETIQUETAS_PRINT_QUEUE_DOC_KEY = 'etiquetas_print_queue';

/** Línea serializable (sin objeto Product completo). */
export type EtiquetasPrintQueueItem = {
  productId: string;
  copies: number;
  customLabelPrice?: number;
  customLabelNombre?: string;
  /** `false` = no imprimir código de barras. */
  labelShowBarcode?: boolean;
};

export type EtiquetasPrintQueueDoc = {
  items: EtiquetasPrintQueueItem[];
  updatedAt: string;
  updatedBy?: string;
};

export type HydratedEtiquetasQueueLine = {
  key: string;
  productId: string;
  product: Product;
  copies: number;
  customLabelPrice?: number;
  customLabelNombre?: string;
  labelShowBarcode?: boolean;
};

function normalizeItem(raw: unknown): EtiquetasPrintQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const productId = typeof o.productId === 'string' ? o.productId.trim() : '';
  if (!productId) return null;
  const copiesRaw = Number(o.copies);
  const copies = Math.max(1, Math.min(999, Math.floor(Number.isFinite(copiesRaw) ? copiesRaw : 1)));
  const item: EtiquetasPrintQueueItem = { productId, copies };
  if (typeof o.customLabelPrice === 'number' && Number.isFinite(o.customLabelPrice) && o.customLabelPrice >= 0) {
    item.customLabelPrice = Math.round(o.customLabelPrice * 100) / 100;
  }
  if (typeof o.customLabelNombre === 'string' && o.customLabelNombre.trim()) {
    item.customLabelNombre = o.customLabelNombre.trim();
  }
  if (o.labelShowBarcode === false) {
    item.labelShowBarcode = false;
  }
  return item;
}

export function parseEtiquetasPrintQueueDoc(doc: unknown): EtiquetasPrintQueueDoc | null {
  if (!doc || typeof doc !== 'object') return null;
  const o = doc as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw.map(normalizeItem).filter((x): x is EtiquetasPrintQueueItem => x != null);
  if (items.length === 0) return null;
  return {
    items,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
    updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : undefined,
  };
}

export function queueLinesToPrintItems(
  lines: Array<{
    productId: string;
    copies: number;
    customLabelPrice?: number;
    customLabelNombre?: string;
    labelShowBarcode?: boolean;
  }>
): EtiquetasPrintQueueItem[] {
  return lines
    .map((l) => {
      const productId = l.productId?.trim();
      if (!productId) return null;
      const copies = Math.max(1, Math.min(999, Math.floor(l.copies) || 1));
      const item: EtiquetasPrintQueueItem = { productId, copies };
      if (typeof l.customLabelPrice === 'number' && Number.isFinite(l.customLabelPrice)) {
        item.customLabelPrice = l.customLabelPrice;
      }
      const name = l.customLabelNombre?.trim();
      if (name) item.customLabelNombre = name;
      if (l.labelShowBarcode === false) item.labelShowBarcode = false;
      return item;
    })
    .filter((x): x is EtiquetasPrintQueueItem => x != null);
}

export function hydrateEtiquetasPrintQueue(
  items: EtiquetasPrintQueueItem[],
  products: readonly Product[]
): { lines: HydratedEtiquetasQueueLine[]; missingIds: string[] } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: HydratedEtiquetasQueueLine[] = [];
  const missingIds: string[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      missingIds.push(item.productId);
      continue;
    }
    lines.push({
      key: crypto.randomUUID(),
      productId: item.productId,
      product,
      copies: item.copies,
      customLabelPrice: item.customLabelPrice,
      customLabelNombre: item.customLabelNombre,
      labelShowBarcode: item.labelShowBarcode,
    });
  }
  return { lines, missingIds };
}

export function countEtiquetasInItems(items: EtiquetasPrintQueueItem[]): number {
  return items.reduce((s, i) => s + (Number(i.copies) || 0), 0);
}

export async function loadEtiquetasPrintQueue(
  sucursalId: string
): Promise<EtiquetasPrintQueueDoc | null> {
  const doc = await getSucursalStateDocOnce<unknown>(sucursalId, ETIQUETAS_PRINT_QUEUE_DOC_KEY);
  return parseEtiquetasPrintQueueDoc(doc);
}

export async function saveEtiquetasPrintQueue(
  sucursalId: string,
  items: EtiquetasPrintQueueItem[],
  updatedBy?: string
): Promise<void> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal activa');
  const normalized = queueLinesToPrintItems(items);
  if (normalized.length === 0) {
    await clearEtiquetasPrintQueue(sid);
    return;
  }
  const doc: EtiquetasPrintQueueDoc = {
    items: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy?.trim() || undefined,
  };
  await saveSucursalStateDoc(sid, ETIQUETAS_PRINT_QUEUE_DOC_KEY, doc);
}

export async function clearEtiquetasPrintQueue(sucursalId: string): Promise<void> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal activa');
  await saveSucursalStateDoc(sid, ETIQUETAS_PRINT_QUEUE_DOC_KEY, {
    items: [],
    updatedAt: new Date().toISOString(),
  } satisfies EtiquetasPrintQueueDoc);
}
