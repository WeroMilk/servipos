import { CLIENT_PRICE_LIST_ORDER, normalizeClientPriceListId } from '@/lib/clientPriceLists';
import type { Client, FormaPago, MetodoPago, Payment, Sale, SaleItem, SaleStatus } from '@/types';
import { getMexicoDateKey, startOfDayFromDateKey } from '@/lib/quincenaMx';
import { getSupabase } from '@/lib/supabaseClient';
import { computeSaleClienteAdeudo } from '@/lib/saleClienteAdeudo';

// ============================================
// VENTAS (Supabase + RPC atómicos)
// ============================================

const SALES_PAGE_SIZE = 500;
const PENDING_OPEN_SALES_LIMIT = 500;

function firestoreTimestampToDate(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }
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
  if (s === 'PPC') return 'PPC';
  if (['01', '02', '03', '04', '08', '28', '29', '99'].includes(s)) return s as FormaPago;
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

/** Mapea documento JSON (Firestore / Supabase) a `Sale`. */
export function saleDataToSale(id: string, d: Record<string, unknown>, sucursalId?: string): Sale | null {
  const productosRaw = Array.isArray(d.productos) ? d.productos : [];
  const pagosRaw = Array.isArray(d.pagos) ? d.pagos : [];

  return {
    id,
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
    sucursalId,
    createdAt: firestoreTimestampToDate(d.createdAt),
    updatedAt: firestoreTimestampToDate(d.updatedAt),
    syncStatus: 'synced',
  };
}

/** Compat: snapshot mínimo tipo Firestore. */
export function saleDocToSale(snap: {
  id: string;
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
}): Sale | null {
  if (!snap.exists()) return null;
  const d = snap.data();
  if (!d) return null;
  return saleDataToSale(snap.id, d, undefined);
}

function yyyymmddFolioZone(d: Date): string {
  return getMexicoDateKey(d).replace(/-/g, '');
}

function clientSnapshotToFirestorePayload(cliente: Client | null | undefined): Record<string, unknown> | null {
  if (!cliente) return null;
  return {
    id: cliente.id,
    rfc: cliente.rfc ?? null,
    nombre: cliente.nombre,
    razonSocial: cliente.razonSocial ?? null,
    isMostrador: cliente.isMostrador,
    listaPreciosId: cliente.listaPreciosId ?? null,
    createdAt: cliente.createdAt instanceof Date ? cliente.createdAt.toISOString() : cliente.createdAt,
    updatedAt: cliente.updatedAt instanceof Date ? cliente.updatedAt.toISOString() : cliente.updatedAt,
  };
}

function saleToRpcPayload(
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Record<string, unknown> {
  return {
    clienteId: sale.clienteId,
    cliente: clientSnapshotToFirestorePayload(sale.cliente ?? null),
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
    cajaSesionId:
      typeof sale.cajaSesionId === 'string' && sale.cajaSesionId.trim().length > 0
        ? sale.cajaSesionId.trim()
        : null,
  };
}

export async function createSaleFirestore(
  sucursalId: string,
  sale: Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncAt'>
): Promise<{ id: string; folio: string }> {
  const supabase = getSupabase();
  const now = new Date();
  const dateStr = yyyymmddFolioZone(now);
  const payload = saleToRpcPayload(sale);
  const { data, error } = await supabase.rpc('rpc_create_sale', {
    p_sucursal_id: sucursalId,
    p_date_str: dateStr,
    p_sale: payload,
  });
  if (error) throw new Error(error.message);
  const out = data as { id?: string; folio?: string } | null;
  if (!out?.id || !out?.folio) throw new Error('Respuesta inválida al crear venta');
  return { id: out.id, folio: out.folio };
}

export async function cancelSaleFirestore(
  sucursalId: string,
  saleId: string,
  motivo?: string,
  cancelacionMotivo?: 'devolucion' | 'panel'
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('rpc_cancel_sale', {
    p_sucursal_id: sucursalId,
    p_sale_id: saleId,
    p_motivo: motivo ?? null,
    p_cancelacion_motivo: cancelacionMotivo ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Parche de doc ya validado por `computeDevolucionParcial` (productos, totales, pagos, notas). */
export async function partialReturnSaleFirestore(
  sucursalId: string,
  saleId: string,
  motivo: string,
  patch: {
    productos: Sale['productos'];
    subtotal: number;
    descuento: number;
    impuestos: number;
    total: number;
    pagos: Sale['pagos'];
    estado: 'completada';
    notas: string;
  }
): Promise<void> {
  const supabase = getSupabase();
  const productos = patch.productos.map((p) => {
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
  });
  const p_patch: Record<string, unknown> = {
    productos,
    subtotal: patch.subtotal,
    descuento: patch.descuento,
    impuestos: patch.impuestos,
    total: patch.total,
    pagos: patch.pagos.map((p) => ({
      id: p.id,
      formaPago: p.formaPago,
      monto: p.monto,
      referencia: p.referencia ?? null,
    })),
    notas: patch.notas,
    estado: patch.estado,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await supabase.rpc('rpc_partial_return_sale', {
    p_sucursal_id: sucursalId,
    p_sale_id: saleId,
    p_motivo: motivo ?? null,
    p_patch,
  });
  if (error) throw new Error(error.message);
}

export async function fetchSalesByCajaSesion(sucursalId: string, sesionId: string): Promise<Sale[]> {
  const sid = sesionId.trim();
  if (!sid) return [];
  const supabase = getSupabase();
  const { data: rows } = await supabase.from('sales').select('id, doc').eq('sucursal_id', sucursalId);
  const list = (rows ?? [])
    .filter((r) => String((r.doc as { cajaSesionId?: string })?.cajaSesionId ?? '').trim() === sid)
    .map((r) => saleDataToSale(r.id, r.doc as Record<string, unknown>, sucursalId))
    .filter((s): s is Sale => s != null);
  return list;
}

export async function fetchSalesForMexicoDateKey(sucursalId: string, dateKey: string): Promise<Sale[]> {
  const start = startOfDayFromDateKey(dateKey);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const supabase = getSupabase();
  const { data: rows } = await supabase.from('sales').select('id, doc').eq('sucursal_id', sucursalId);
  const list = (rows ?? [])
    .map((r) => saleDataToSale(r.id, r.doc as Record<string, unknown>, sucursalId))
    .filter((s): s is Sale => s != null)
    .filter((s) => s.createdAt >= start && s.createdAt < end);
  list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return list;
}

const CLIENT_SALES_QUERY_LIMIT = 500;

export async function fetchSalesByClienteIdFirestore(
  sucursalId: string,
  clienteId: string
): Promise<Sale[]> {
  const cid = clienteId.trim();
  if (!cid || cid === 'mostrador') return [];
  const supabase = getSupabase();
  const { data: rows } = await supabase.from('sales').select('id, doc').eq('sucursal_id', sucursalId);
  const list = (rows ?? [])
    .filter((r) => String((r.doc as { clienteId?: string })?.clienteId ?? '') === cid)
    .map((r) => saleDataToSale(r.id, r.doc as Record<string, unknown>, sucursalId))
    .filter((s): s is Sale => s != null)
    .slice(0, CLIENT_SALES_QUERY_LIMIT);
  list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list;
}

export async function getSaleByIdFirestore(sucursalId: string, saleId: string): Promise<Sale | undefined> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('sales')
    .select('id, doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', saleId)
    .maybeSingle();
  if (!data) return undefined;
  return saleDataToSale(data.id, data.doc as Record<string, unknown>, sucursalId) ?? undefined;
}

export async function updatePendingOpenSaleFirestore(
  sucursalId: string,
  saleId: string,
  patch: {
    productos: SaleItem[];
    subtotal: number;
    descuento: number;
    impuestos: number;
    total: number;
    clienteId: string;
    cliente?: Client | null;
    posResumeGlobalDiscount: number;
    posResumeListaPrecios: string;
  }
): Promise<void> {
  const sid = saleId.trim();
  if (!sid) throw new Error('Venta inválida');
  const supabase = getSupabase();
  const productosFs = patch.productos.map((p) => {
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
  });
  const p_patch = {
    productos: productosFs,
    subtotal: patch.subtotal,
    descuento: patch.descuento,
    impuestos: patch.impuestos,
    total: patch.total,
    clienteId: patch.clienteId,
    cliente: clientSnapshotToFirestorePayload(patch.cliente ?? null),
    posResumeGlobalDiscount: patch.posResumeGlobalDiscount,
    posResumeListaPrecios: patch.posResumeListaPrecios?.trim() || null,
  };
  const { error } = await supabase.rpc('rpc_update_pending_open_sale', {
    p_sucursal_id: sucursalId,
    p_sale_id: sid,
    p_patch: p_patch,
  });
  if (error) throw new Error(error.message);
}

export async function completePendingSaleFirestore(
  sucursalId: string,
  saleId: string,
  patch: {
    formaPago: FormaPago;
    metodoPago: MetodoPago;
    pagos: Payment[];
    cambio: number;
    usuarioNombreCierre?: string | null;
    cajaSesionId?: string | null;
    clienteId?: string;
    cliente?: Client | null;
  }
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('sales')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', saleId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Venta no encontrada');
  const sale = saleDataToSale(saleId, row.doc as Record<string, unknown>, sucursalId);
  if (!sale) throw new Error('Venta no encontrada');
  if (sale.estado !== 'pendiente') throw new Error('Esta venta ya no está pendiente de pago');
  if (sale.facturaId) throw new Error('No se puede completar una venta ya vinculada a factura');

  const nombreCierre =
    typeof patch.usuarioNombreCierre === 'string' && patch.usuarioNombreCierre.trim().length > 0
      ? patch.usuarioNombreCierre.trim()
      : sale.usuarioNombre ?? null;

  const doc = { ...(row.doc as Record<string, unknown>) };
  doc.estado = 'completada';
  doc.formaPago = patch.formaPago;
  doc.metodoPago = patch.metodoPago;
  doc.pagos = patch.pagos.map((p) => ({
    id: p.id,
    formaPago: p.formaPago,
    monto: p.monto,
    referencia: p.referencia ?? null,
  }));
  doc.cambio = patch.cambio;
  doc.usuarioNombre = nombreCierre;
  if (typeof patch.cajaSesionId === 'string' && patch.cajaSesionId.trim().length > 0) {
    doc.cajaSesionId = patch.cajaSesionId.trim();
  }
  if (patch.clienteId !== undefined) {
    doc.clienteId = patch.clienteId;
    doc.cliente = clientSnapshotToFirestorePayload(patch.cliente ?? null);
  }
  doc.updatedAt = new Date().toISOString();

  const { error } = await supabase
    .from('sales')
    .update({ doc, updated_at: new Date().toISOString() })
    .eq('sucursal_id', sucursalId)
    .eq('id', saleId);
  if (error) throw new Error(error.message);
}

/** Agrega cobros a una venta ya completada que aún tiene saldo (cuentas por cobrar desde POS). */
export async function appendPagosToCompletedSaleFirestore(
  sucursalId: string,
  saleId: string,
  patch: {
    pagosToAdd: Payment[];
    cambio: number;
    cajaSesionId?: string | null;
  }
): Promise<void> {
  const sid = saleId.trim();
  if (!sid) throw new Error('Venta inválida');
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('sales')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', sid)
    .maybeSingle();
  if (!row?.doc) throw new Error('Venta no encontrada');
  const sale = saleDataToSale(sid, row.doc as Record<string, unknown>, sucursalId);
  if (!sale) throw new Error('Venta no encontrada');
  if (sale.estado !== 'completada') {
    throw new Error('Solo se pueden registrar cobros sobre ventas completadas con saldo pendiente');
  }
  if (sale.facturaId) throw new Error('No se puede registrar cobro en POS sobre una venta ya facturada');

  const prevAdeudo = computeSaleClienteAdeudo(sale);
  if (prevAdeudo <= 0.02) throw new Error('Este ticket no tiene saldo pendiente');

  const sumAdd = patch.pagosToAdd.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  if (sumAdd <= 0) throw new Error('Indique un importe de cobro válido');
  if (sumAdd > prevAdeudo + 0.05) throw new Error('El cobro supera el saldo pendiente del ticket');

  const existing = (sale.pagos ?? []).map((p) => ({
    id: p.id,
    formaPago: p.formaPago,
    monto: p.monto,
    referencia: p.referencia ?? null,
  }));
  const toAdd = patch.pagosToAdd.map((p) => ({
    id: p.id,
    formaPago: p.formaPago,
    monto: p.monto,
    referencia: p.referencia ?? null,
  }));

  const doc = { ...(row.doc as Record<string, unknown>) };
  doc.pagos = [...existing, ...toAdd];
  doc.cambio = patch.cambio;
  if (typeof patch.cajaSesionId === 'string' && patch.cajaSesionId.trim().length > 0) {
    doc.cajaSesionId = patch.cajaSesionId.trim();
  }
  doc.updatedAt = new Date().toISOString();

  const { error } = await supabase
    .from('sales')
    .update({ doc, updated_at: new Date().toISOString() })
    .eq('sucursal_id', sucursalId)
    .eq('id', sid);
  if (error) throw new Error(error.message);
}

export async function getSaleByFolioFirestore(sucursalId: string, folioRaw: string): Promise<Sale | null> {
  const folio = folioRaw.trim();
  if (!folio) return null;
  const supabase = getSupabase();
  const { data: rows } = await supabase.from('sales').select('id, doc').eq('sucursal_id', sucursalId);
  const hits = (rows ?? []).filter((r) => String((r.doc as { folio?: string })?.folio ?? '') === folio);
  const list = hits
    .map((r) => saleDataToSale(r.id, r.doc as Record<string, unknown>, sucursalId))
    .filter((s): s is Sale => s != null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return list[0] ?? null;
}

export async function patchSaleInvoiceFirestore(
  sucursalId: string,
  saleId: string,
  patch: { facturaId: string | null; estado: SaleStatus }
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('sales')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', saleId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Venta no encontrada');
  const doc = { ...(row.doc as Record<string, unknown>) };
  if (patch.facturaId === null) {
    delete doc.facturaId;
  } else {
    doc.facturaId = patch.facturaId;
  }
  doc.estado = patch.estado;
  doc.updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from('sales')
    .update({ doc, updated_at: new Date().toISOString() })
    .eq('sucursal_id', sucursalId)
    .eq('id', saleId);
  if (error) throw new Error(error.message);
}

let lastSales: Sale[] = [];
let lastSalesRecent: Sale[] = [];
let lastSalesPending: Sale[] = [];
const salesListeners = new Set<(sales: Sale[]) => void>();
let salesChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let salesSucursalId: string | null = null;

function mergeSalesCatalog(): Sale[] {
  const byId = new Map<string, Sale>();
  for (const s of lastSalesPending) byId.set(s.id, s);
  for (const s of lastSalesRecent) byId.set(s.id, s);
  return Array.from(byId.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function notifySalesCatalogListeners(): void {
  lastSales = mergeSalesCatalog();
  salesListeners.forEach((l) => l([...lastSales]));
}

function mapRow(r: { id: string; doc: unknown }, sucursalId: string): Sale | null {
  return saleDataToSale(r.id, r.doc as Record<string, unknown>, sucursalId);
}

export function getSalesCatalogSnapshot(): Sale[] {
  return lastSales;
}

export function subscribeSalesCatalog(sucursalId: string, onSales: (sales: Sale[]) => void): () => void {
  onSales([...lastSales]);
  salesListeners.add(onSales);

  const supabase = getSupabase();

  const reload = async () => {
    const { data: recentRows, error: e1 } = await supabase
      .from('sales')
      .select('id, doc, updated_at')
      .eq('sucursal_id', sucursalId)
      .order('updated_at', { ascending: false })
      .limit(SALES_PAGE_SIZE);
    if (e1) {
      console.error('Supabase sales (recientes):', e1);
      lastSalesRecent = [];
    } else {
      lastSalesRecent = (recentRows ?? [])
        .map((r) => mapRow(r, sucursalId))
        .filter((s): s is Sale => s != null);
    }

    const { data: pendRows, error: e2 } = await supabase
      .from('sales')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (e2) {
      console.error('Supabase sales (pendientes):', e2);
      lastSalesPending = [];
    } else {
      lastSalesPending = (pendRows ?? [])
        .filter((r) => String((r.doc as { estado?: string })?.estado ?? '') === 'pendiente')
        .map((r) => mapRow(r, sucursalId))
        .filter((s): s is Sale => s != null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, PENDING_OPEN_SALES_LIMIT);
    }
    notifySalesCatalogListeners();
  };

  if (salesSucursalId !== sucursalId) {
    if (salesChannel) {
      void supabase.removeChannel(salesChannel);
      salesChannel = null;
    }
    lastSalesRecent = [];
    lastSalesPending = [];
    lastSales = [];
    salesSucursalId = sucursalId;
    notifySalesCatalogListeners();
    void reload();
    salesChannel = supabase
      .channel(`sales-${sucursalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales', filter: `sucursal_id=eq.${sucursalId}` },
        () => {
          void reload();
        }
      )
      .subscribe();
  } else {
    void reload();
  }

  return () => {
    salesListeners.delete(onSales);
    if (salesListeners.size === 0) {
      if (salesChannel) {
        void supabase.removeChannel(salesChannel);
        salesChannel = null;
      }
      salesSucursalId = null;
      lastSalesRecent = [];
      lastSalesPending = [];
      lastSales = [];
    }
  };
}

/** Suscripción en tiempo real a un documento de venta (p. ej. hook detalle). */
export function subscribeSaleDocument(
  sucursalId: string,
  saleId: string,
  onSale: (sale: Sale | null) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data } = await supabase
      .from('sales')
      .select('id, doc')
      .eq('sucursal_id', sucursalId)
      .eq('id', saleId)
      .maybeSingle();
    onSale(data ? mapRow(data, sucursalId) : null);
  };
  void load();
  const ch = supabase
    .channel(`sale-doc-${sucursalId}-${saleId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sales', filter: `id=eq.${saleId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
