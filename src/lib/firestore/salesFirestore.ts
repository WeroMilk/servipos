import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  runTransaction,
  serverTimestamp,
  updateDoc,
  deleteField,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Client, FormaPago, MetodoPago, Payment, Sale, SaleItem, SaleStatus } from '@/types';
import { getMexicoDateKey } from '@/lib/quincenaMx';

// ============================================
// VENTAS EN FIRESTORE (tiempo real + folio atómico)
// ============================================

const SALES_PAGE_SIZE = 500;

function salesCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'sales');
}

function movementsCol(sucursalId: string) {
  return collection(db, 'sucursales', sucursalId, 'inventoryMovements');
}

function ventasDiarioCounterRef(sucursalId: string) {
  return doc(db, 'sucursales', sucursalId, 'counters', 'ventasDiario');
}

function firestoreTimestampToDate(value: unknown): Date {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return new Date();
}

function parseFormaPago(v: unknown): FormaPago {
  const s = String(v ?? '01');
  if (s === 'TTS') return 'TTS';
  if (s === 'DEV') return 'DEV';
  if (['01', '02', '03', '04', '08', '28', '99'].includes(s)) return s as FormaPago;
  return '01';
}

function parseCancelacionMotivo(v: unknown): 'devolucion' | 'panel' | undefined {
  if (v === 'devolucion' || v === 'panel') return v;
  return undefined;
}

function parseMetodoPago(v: unknown): MetodoPago {
  return v === 'PPD' ? 'PPD' : 'PUE';
}

function parseEstado(v: unknown): SaleStatus {
  const s = String(v ?? 'completada');
  if (s === 'pendiente' || s === 'completada' || s === 'cancelada' || s === 'facturada') return s;
  return 'completada';
}

function mapSaleItem(raw: Record<string, unknown>): SaleItem {
  return {
    id: String(raw.id ?? ''),
    productId: String(raw.productId ?? ''),
    cantidad: Number(raw.cantidad) || 0,
    precioUnitario: Number(raw.precioUnitario) || 0,
    descuento: Number(raw.descuento) || 0,
    impuesto: Number(raw.impuesto) || 0,
    subtotal: Number(raw.subtotal) || 0,
    total: Number(raw.total) || 0,
  };
}

function mapPayment(raw: Record<string, unknown>): Payment {
  return {
    id: String(raw.id ?? ''),
    formaPago: parseFormaPago(raw.formaPago),
    monto: Number(raw.monto) || 0,
    referencia: raw.referencia != null ? String(raw.referencia) : undefined,
  };
}

function mapClientEmbedded(raw: Record<string, unknown>): Client {
  return {
    id: String(raw.id ?? ''),
    rfc: raw.rfc != null ? String(raw.rfc) : undefined,
    nombre: String(raw.nombre ?? ''),
    razonSocial: raw.razonSocial != null ? String(raw.razonSocial) : undefined,
    isMostrador: raw.isMostrador === true,
    createdAt: firestoreTimestampToDate(raw.createdAt),
    updatedAt: firestoreTimestampToDate(raw.updatedAt),
    syncStatus: 'synced',
  };
}

export function saleDocToSale(snap: DocumentSnapshot): Sale | null {
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  const productosRaw = Array.isArray(d.productos) ? d.productos : [];
  const pagosRaw = Array.isArray(d.pagos) ? d.pagos : [];
  const sucursalFromPath = snap.ref.parent.parent?.id;

  return {
    id: snap.id,
    folio: String(d.folio ?? ''),
    clienteId: String(d.clienteId ?? ''),
    cliente:
      d.cliente && typeof d.cliente === 'object'
        ? mapClientEmbedded(d.cliente as Record<string, unknown>)
        : undefined,
    productos: productosRaw.map((p) => mapSaleItem(p as Record<string, unknown>)),
    subtotal: Number(d.subtotal) || 0,
    descuento: Number(d.descuento) || 0,
    impuestos: Number(d.impuestos) || 0,
    total: Number(d.total) || 0,
    formaPago: parseFormaPago(d.formaPago),
    metodoPago: parseMetodoPago(d.metodoPago),
    pagos: pagosRaw.map((p) => mapPayment(p as Record<string, unknown>)),
    cambio: d.cambio != null ? Number(d.cambio) : undefined,
    estado: parseEstado(d.estado),
    cancelacionMotivo: parseCancelacionMotivo(d.cancelacionMotivo),
    facturaId: d.facturaId != null ? String(d.facturaId) : undefined,
    notas: d.notas != null ? String(d.notas) : undefined,
    transferenciaSucursalDestinoId:
      typeof d.transferenciaSucursalDestinoId === 'string' && d.transferenciaSucursalDestinoId
        ? String(d.transferenciaSucursalDestinoId)
        : undefined,
    usuarioId: String(d.usuarioId ?? ''),
    usuarioNombre:
      typeof d.usuarioNombre === 'string' && d.usuarioNombre.trim().length > 0
        ? String(d.usuarioNombre).trim()
        : undefined,
    sucursalId: typeof sucursalFromPath === 'string' && sucursalFromPath.length > 0 ? sucursalFromPath : undefined,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

/** Fecha del folio diario en zona Hermosillo (consistente con checador / panel). */
function yyyymmddFolioZone(d: Date): string {
  return getMexicoDateKey(d).replace(/-/g, '');
}

function saleInputToPayload(
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>,
  folio: string
): Record<string, unknown> {
  return {
    folio,
    clienteId: sale.clienteId,
    cliente: sale.cliente
      ? {
          id: sale.cliente.id,
          rfc: sale.cliente.rfc ?? null,
          nombre: sale.cliente.nombre,
          razonSocial: sale.cliente.razonSocial ?? null,
          isMostrador: sale.cliente.isMostrador,
          createdAt: sale.cliente.createdAt,
          updatedAt: sale.cliente.updatedAt,
        }
      : null,
    productos: sale.productos.map((p) => ({
      id: p.id,
      productId: p.productId,
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario,
      descuento: p.descuento,
      impuesto: p.impuesto,
      subtotal: p.subtotal,
      total: p.total,
    })),
    subtotal: sale.subtotal,
    descuento: sale.descuento,
    impuestos: sale.impuestos,
    total: sale.total,
    formaPago: sale.formaPago,
    metodoPago: sale.metodoPago,
    pagos: sale.pagos.map((p) => ({
      id: p.id,
      formaPago: p.formaPago,
      monto: p.monto,
      referencia: p.referencia ?? null,
    })),
    cambio: sale.cambio ?? null,
    estado: sale.estado,
    facturaId: sale.facturaId ?? null,
    notas: sale.notas ?? null,
    usuarioId: sale.usuarioId,
    usuarioNombre: sale.usuarioNombre?.trim() ? sale.usuarioNombre.trim() : null,
    transferenciaSucursalDestinoId:
      sale.transferenciaSucursalDestinoId && sale.transferenciaSucursalDestinoId.length > 0
        ? sale.transferenciaSucursalDestinoId
        : null,
  };
}

/**
 * Crea venta: folio diario atómico + descuento de stock + movimientos en una sola transacción.
 */
export async function createSaleFirestore(
  sucursalId: string,
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Promise<{ id: string; folio: string }> {
  const saleRef = doc(salesCol(sucursalId));
  const counterRef = ventasDiarioCounterRef(sucursalId);
  const now = new Date();
  const dateStr = yyyymmddFolioZone(now);
  let folioAsignado = '';

  await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    let seq = 1;
    if (counterSnap.exists()) {
      const c = counterSnap.data() as Record<string, unknown>;
      if (String(c.fecha ?? '') === dateStr) {
        seq = (typeof c.seq === 'number' ? c.seq : Number(c.seq) || 0) + 1;
      }
    }
    const folio = `V-${dateStr}-${String(seq).padStart(4, '0')}`;
    folioAsignado = folio;

    const productRefs = sale.productos.map((item) =>
      doc(db, 'sucursales', sucursalId, 'products', item.productId)
    );
    const productSnaps = await Promise.all(productRefs.map((r) => transaction.get(r)));

    const isTts =
      sale.formaPago === 'TTS' &&
      Boolean(sale.transferenciaSucursalDestinoId?.trim()) &&
      sale.transferenciaSucursalDestinoId != null;

    const transferItems: {
      productIdOrigen: string;
      sku: string;
      nombre: string;
      cantidad: number;
    }[] = [];

    for (let i = 0; i < sale.productos.length; i++) {
      const item = sale.productos[i]!;
      const ps = productSnaps[i]!;
      if (!ps.exists()) throw new Error(`Producto no encontrado: ${item.productId}`);
      const pdata = ps.data() as Record<string, unknown>;
      const cantidadAnterior =
        typeof pdata.existencia === 'number' ? pdata.existencia : Number(pdata.existencia) || 0;
      const cantidadNueva = cantidadAnterior - item.cantidad;
      if (cantidadNueva < 0) throw new Error('Stock insuficiente');

      transaction.update(productRefs[i]!, {
        existencia: cantidadNueva,
        updatedAt: serverTimestamp(),
      });

      const movRef = doc(movementsCol(sucursalId));
      transaction.set(movRef, {
        productId: item.productId,
        tipo: 'salida',
        cantidad: item.cantidad,
        cantidadAnterior,
        cantidadNueva,
        motivo: isTts ? 'Traspaso a tienda (salida)' : 'Venta',
        referencia: saleRef.id,
        usuarioId: sale.usuarioId,
        createdAt: serverTimestamp(),
      });

      if (isTts) {
        transferItems.push({
          productIdOrigen: item.productId,
          sku: String(pdata.sku ?? ''),
          nombre: String(pdata.nombre ?? ''),
          cantidad: item.cantidad,
        });
      }
    }

    if (isTts && transferItems.length > 0) {
      const destId = sale.transferenciaSucursalDestinoId!.trim();
      const tid = saleRef.id;
      const incRef = doc(db, 'sucursales', destId, 'incomingTransfers', tid);
      const outRef = doc(db, 'sucursales', sucursalId, 'outgoingTransfers', tid);
      transaction.set(incRef, {
        estado: 'pendiente',
        origenSucursalId: sucursalId,
        origenSaleId: tid,
        origenFolio: folio,
        items: transferItems,
        usuarioNombre: sale.usuarioNombre?.trim() || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(outRef, {
        estado: 'pendiente',
        destinoSucursalId: destId,
        saleId: tid,
        folio,
        items: transferItems,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.set(counterRef, {
      fecha: dateStr,
      seq,
      updatedAt: serverTimestamp(),
    });

    const payload = saleInputToPayload(sale, folio);
    transaction.set(saleRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return { id: saleRef.id, folio: folioAsignado };
}

export async function cancelSaleFirestore(
  sucursalId: string,
  saleId: string,
  motivo?: string,
  cancelacionMotivo?: 'devolucion' | 'panel'
): Promise<void> {
  const saleRef = doc(db, 'sucursales', sucursalId, 'sales', saleId);

  await runTransaction(db, async (transaction) => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error('Venta no encontrada');
    const sale = saleDocToSale(saleSnap);
    if (!sale) throw new Error('Venta no encontrada');
    if (sale.estado === 'cancelada') throw new Error('La venta ya está cancelada');
    if (sale.facturaId) throw new Error('No se puede cancelar una venta facturada');

    const productRefs = sale.productos.map((item) =>
      doc(db, 'sucursales', sucursalId, 'products', item.productId)
    );
    const productSnaps = await Promise.all(productRefs.map((r) => transaction.get(r)));

    for (let i = 0; i < sale.productos.length; i++) {
      const item = sale.productos[i]!;
      const ps = productSnaps[i]!;
      if (!ps.exists()) throw new Error(`Producto no encontrado: ${item.productId}`);
      const pdata = ps.data() as Record<string, unknown>;
      const cantidadAnterior =
        typeof pdata.existencia === 'number' ? pdata.existencia : Number(pdata.existencia) || 0;
      const cantidadNueva = cantidadAnterior + item.cantidad;

      transaction.update(productRefs[i]!, {
        existencia: cantidadNueva,
        updatedAt: serverTimestamp(),
      });

      const movRef = doc(movementsCol(sucursalId));
      transaction.set(movRef, {
        productId: item.productId,
        tipo: 'entrada',
        cantidad: item.cantidad,
        cantidadAnterior,
        cantidadNueva,
        motivo: `Cancelación de venta: ${motivo || 'Sin motivo'}`,
        referencia: saleId,
        usuarioId: sale.usuarioId,
        createdAt: serverTimestamp(),
      });
    }

    const tipoEtiqueta =
      cancelacionMotivo === 'devolucion' ? 'devolución' : cancelacionMotivo === 'panel' ? 'panel' : 'venta';
    const notas = motivo
      ? `${sale.notas || ''} | Cancelada (${tipoEtiqueta}): ${motivo}`.trim()
      : sale.notas;

    transaction.update(saleRef, {
      estado: 'cancelada',
      cancelacionMotivo: cancelacionMotivo ?? null,
      notas: notas || null,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function getSaleByIdFirestore(
  sucursalId: string,
  saleId: string
): Promise<Sale | undefined> {
  const ref = doc(db, 'sucursales', sucursalId, 'sales', saleId);
  const snap = await getDoc(ref);
  const s = saleDocToSale(snap);
  return s ?? undefined;
}

/** Busca venta por folio diario (ej. V-20260322-0001) en la sucursal actual. */
export async function getSaleByFolioFirestore(
  sucursalId: string,
  folioRaw: string
): Promise<Sale | null> {
  const folio = folioRaw.trim();
  if (!folio) return null;
  const q = query(salesCol(sucursalId), where('folio', '==', folio), limit(10));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const list = snap.docs
    .map((d) => saleDocToSale(d))
    .filter((s): s is Sale => s != null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list[0] ?? null;
}

export async function patchSaleInvoiceFirestore(
  sucursalId: string,
  saleId: string,
  patch: { facturaId: string | null; estado: SaleStatus }
): Promise<void> {
  const ref = doc(db, 'sucursales', sucursalId, 'sales', saleId);
  if (patch.facturaId === null) {
    await updateDoc(ref, {
      facturaId: deleteField(),
      estado: patch.estado,
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      facturaId: patch.facturaId,
      estado: patch.estado,
      updatedAt: serverTimestamp(),
    });
  }
}

// --- Lista en tiempo real (compartida entre hooks) ---

let lastSales: Sale[] = [];
const salesListeners = new Set<(sales: Sale[]) => void>();
let salesUnsub: Unsubscribe | null = null;
let salesSucursalId: string | null = null;

export function getSalesCatalogSnapshot(): Sale[] {
  return lastSales;
}

export function subscribeSalesCatalog(
  sucursalId: string,
  onSales: (sales: Sale[]) => void
): () => void {
  onSales([...lastSales]);
  salesListeners.add(onSales);

  if (salesSucursalId !== sucursalId) {
    salesUnsub?.();
    salesSucursalId = sucursalId;
    const q = query(salesCol(sucursalId), orderBy('createdAt', 'desc'), limit(SALES_PAGE_SIZE));
    salesUnsub = onSnapshot(
      q,
      (snap) => {
        lastSales = snap.docs
          .map((d) => saleDocToSale(d))
          .filter((s): s is Sale => s != null);
        salesListeners.forEach((l) => l([...lastSales]));
      },
      (err) => {
        console.error('Firestore sales:', err);
        lastSales = [];
        salesListeners.forEach((l) => l([]));
      }
    );
  }

  return () => {
    salesListeners.delete(onSales);
    if (salesListeners.size === 0) {
      salesUnsub?.();
      salesUnsub = null;
      salesSucursalId = null;
      lastSales = [];
    }
  };
}
