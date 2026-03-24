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
import { CLIENT_PRICE_LIST_ORDER, normalizeClientPriceListId } from '@/lib/clientPriceLists';
import type { Client, FormaPago, MetodoPago, Payment, Sale, SaleItem, SaleStatus } from '@/types';
import { getMexicoDateKey } from '@/lib/quincenaMx';

// ============================================
// VENTAS EN FIRESTORE (tiempo real + folio atómico)
// ============================================

const SALES_PAGE_SIZE = 500;
/** Ventas abiertas (fiado) fuera del top N por fecha: query aparte para que no desaparezcan del catálogo. */
const PENDING_OPEN_SALES_LIMIT = 500;

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
  if (s === 'COT') return 'COT';
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

function parsePosResumeListaPrecios(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const s = v.trim();
  return (CLIENT_PRICE_LIST_ORDER as readonly string[]).includes(s) ? s : undefined;
}

function saleItemProductoNombreFromRaw(raw: Record<string, unknown>): string | undefined {
  const direct = raw.productoNombre;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const po = raw.producto;
  if (po && typeof po === 'object') {
    const n = (po as Record<string, unknown>).nombre;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return undefined;
}

function mapSaleItem(raw: Record<string, unknown>): SaleItem {
  return {
    id: String(raw.id ?? ''),
    productId: String(raw.productId ?? ''),
    productoNombre: saleItemProductoNombreFromRaw(raw),
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
    listaPreciosId:
      raw.listaPreciosId != null && raw.listaPreciosId !== ''
        ? normalizeClientPriceListId(raw.listaPreciosId)
        : undefined,
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
    posResumeGlobalDiscount:
      d.posResumeGlobalDiscount != null && Number.isFinite(Number(d.posResumeGlobalDiscount))
        ? Number(d.posResumeGlobalDiscount)
        : undefined,
    posResumeListaPrecios: parsePosResumeListaPrecios(d.posResumeListaPrecios),
    cajaSesionId:
      typeof d.cajaSesionId === 'string' && d.cajaSesionId.trim().length > 0
        ? d.cajaSesionId.trim()
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
          listaPreciosId: sale.cliente.listaPreciosId ?? null,
          createdAt: sale.cliente.createdAt,
          updatedAt: sale.cliente.updatedAt,
        }
      : null,
    productos: sale.productos.map((p) => {
      const nombre =
        typeof p.productoNombre === 'string' && p.productoNombre.trim()
          ? p.productoNombre.trim()
          : p.producto?.nombre?.trim();
      return {
        id: p.id,
        productId: p.productId,
        ...(nombre ? { productoNombre: nombre } : {}),
        cantidad: p.cantidad,
        precioUnitario: p.precioUnitario,
        descuento: p.descuento,
        impuesto: p.impuesto,
        subtotal: p.subtotal,
        total: p.total,
      };
    }),
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
    posResumeGlobalDiscount: sale.posResumeGlobalDiscount ?? null,
    posResumeListaPrecios: sale.posResumeListaPrecios ?? null,
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

/** Ventas ligadas a una sesión de caja (arqueo / cierre). */
export async function fetchSalesByCajaSesion(
  sucursalId: string,
  sesionId: string
): Promise<Sale[]> {
  const sid = sesionId.trim();
  if (!sid) return [];
  const q = query(salesCol(sucursalId), where('cajaSesionId', '==', sid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => saleDocToSale(d)).filter((s): s is Sale => s != null);
}

const CLIENT_SALES_QUERY_LIMIT = 500;

/** Ventas de un cliente en la sucursal (p. ej. historial en pantalla Clientes). */
export async function fetchSalesByClienteIdFirestore(
  sucursalId: string,
  clienteId: string
): Promise<Sale[]> {
  const cid = clienteId.trim();
  if (!cid || cid === 'mostrador') return [];
  const q = query(
    salesCol(sucursalId),
    where('clienteId', '==', cid),
    limit(CLIENT_SALES_QUERY_LIMIT)
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => saleDocToSale(d)).filter((s): s is Sale => s != null);
  list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list;
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
/** Completa cobro de una venta en estado `pendiente` (sin tocar inventario). */
export async function completePendingSaleFirestore(
  sucursalId: string,
  saleId: string,
  patch: {
    formaPago: FormaPago;
    metodoPago: MetodoPago;
    pagos: Payment[];
    cambio: number;
    /** Cajero que cierra el cobro (si se omite, se conserva el de la venta). */
    usuarioNombreCierre?: string | null;
    /** Asocia la venta a la sesión de caja abierta al cobrar. */
    cajaSesionId?: string | null;
  }
): Promise<void> {
  const saleRef = doc(db, 'sucursales', sucursalId, 'sales', saleId);

  await runTransaction(db, async (transaction) => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error('Venta no encontrada');
    const sale = saleDocToSale(saleSnap);
    if (!sale) throw new Error('Venta no encontrada');
    if (sale.estado !== 'pendiente') throw new Error('Esta venta ya no está pendiente de pago');
    if (sale.facturaId) throw new Error('No se puede completar una venta ya vinculada a factura');

    const nombreCierre =
      typeof patch.usuarioNombreCierre === 'string' && patch.usuarioNombreCierre.trim().length > 0
        ? patch.usuarioNombreCierre.trim()
        : sale.usuarioNombre ?? null;

    const cajaSesionPatch =
      typeof patch.cajaSesionId === 'string' && patch.cajaSesionId.trim().length > 0
        ? { cajaSesionId: patch.cajaSesionId.trim() }
        : {};

    transaction.update(saleRef, {
      estado: 'completada',
      formaPago: patch.formaPago,
      metodoPago: patch.metodoPago,
      pagos: patch.pagos.map((p) => ({
        id: p.id,
        formaPago: p.formaPago,
        monto: p.monto,
        referencia: p.referencia ?? null,
      })),
      cambio: patch.cambio,
      usuarioNombre: nombreCierre,
      ...cajaSesionPatch,
      updatedAt: serverTimestamp(),
    });
  });
}

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
let lastSalesRecent: Sale[] = [];
let lastSalesPending: Sale[] = [];
const salesListeners = new Set<(sales: Sale[]) => void>();
let salesUnsubRecent: Unsubscribe | null = null;
let salesUnsubPending: Unsubscribe | null = null;
let salesSucursalId: string | null = null;

function mergeSalesCatalog(): Sale[] {
  const byId = new Map<string, Sale>();
  for (const s of lastSalesPending) byId.set(s.id, s);
  for (const s of lastSalesRecent) byId.set(s.id, s);
  return Array.from(byId.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function notifySalesCatalogListeners(): void {
  lastSales = mergeSalesCatalog();
  salesListeners.forEach((l) => l([...lastSales]));
}

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
    salesUnsubRecent?.();
    salesUnsubPending?.();
    salesUnsubRecent = null;
    salesUnsubPending = null;
    lastSalesRecent = [];
    lastSalesPending = [];
    lastSales = [];
    salesSucursalId = sucursalId;
    notifySalesCatalogListeners();

    const qRecent = query(salesCol(sucursalId), orderBy('createdAt', 'desc'), limit(SALES_PAGE_SIZE));
    const qPending = query(
      salesCol(sucursalId),
      where('estado', '==', 'pendiente'),
      orderBy('createdAt', 'desc'),
      limit(PENDING_OPEN_SALES_LIMIT)
    );

    salesUnsubRecent = onSnapshot(
      qRecent,
      (snap) => {
        lastSalesRecent = snap.docs
          .map((d) => saleDocToSale(d))
          .filter((s): s is Sale => s != null);
        notifySalesCatalogListeners();
      },
      (err) => {
        console.error('Firestore sales (recientes):', err);
        lastSalesRecent = [];
        notifySalesCatalogListeners();
      }
    );

    salesUnsubPending = onSnapshot(
      qPending,
      (snap) => {
        lastSalesPending = snap.docs
          .map((d) => saleDocToSale(d))
          .filter((s): s is Sale => s != null);
        notifySalesCatalogListeners();
      },
      (err) => {
        console.error('Firestore sales (pendientes):', err);
        lastSalesPending = [];
        notifySalesCatalogListeners();
      }
    );
  }

  return () => {
    salesListeners.delete(onSales);
    if (salesListeners.size === 0) {
      salesUnsubRecent?.();
      salesUnsubPending?.();
      salesUnsubRecent = null;
      salesUnsubPending = null;
      salesSucursalId = null;
      lastSalesRecent = [];
      lastSalesPending = [];
      lastSales = [];
    }
  };
}
