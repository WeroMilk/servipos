import type { Invoice } from '@/types';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function parseInvoiceStatus(v: unknown): Invoice['estado'] {
  const s = String(v ?? 'pendiente');
  if (s === 'pendiente' || s === 'timbrada' || s === 'cancelada' || s === 'error') return s;
  return 'pendiente';
}

function mapInvoice(sucursalId: string, id: string, doc: Record<string, unknown>): Invoice {
  return {
    id,
    uuid: typeof doc.uuid === 'string' ? doc.uuid : undefined,
    folio: String(doc.folio ?? ''),
    serie: String(doc.serie ?? ''),
    ventaId: typeof doc.ventaId === 'string' ? doc.ventaId : undefined,
    clienteId: String(doc.clienteId ?? ''),
    cliente: doc.cliente && typeof doc.cliente === 'object' ? (doc.cliente as Invoice['cliente']) : undefined,
    emisor: (doc.emisor ?? {}) as Invoice['emisor'],
    productos: Array.isArray(doc.productos) ? (doc.productos as Invoice['productos']) : [],
    subtotal: Number(doc.subtotal) || 0,
    descuento: Number(doc.descuento) || 0,
    impuestosTrasladados: Number(doc.impuestosTrasladados) || 0,
    impuestosRetenidos: Number(doc.impuestosRetenidos) || 0,
    total: Number(doc.total) || 0,
    formaPago: doc.formaPago as Invoice['formaPago'],
    metodoPago: doc.metodoPago as Invoice['metodoPago'],
    lugarExpedicion: String(doc.lugarExpedicion ?? ''),
    fechaEmision: tsToDate(doc.fechaEmision),
    fechaTimbrado: doc.fechaTimbrado ? tsToDate(doc.fechaTimbrado) : undefined,
    selloDigital: typeof doc.selloDigital === 'string' ? doc.selloDigital : undefined,
    cadenaOriginal: typeof doc.cadenaOriginal === 'string' ? doc.cadenaOriginal : undefined,
    certificado: typeof doc.certificado === 'string' ? doc.certificado : undefined,
    estado: parseInvoiceStatus(doc.estado),
    xml: typeof doc.xml === 'string' ? doc.xml : undefined,
    pdfUrl: typeof doc.pdfUrl === 'string' ? doc.pdfUrl : undefined,
    motivoCancelacion: typeof doc.motivoCancelacion === 'string' ? doc.motivoCancelacion : undefined,
    fechaCancelacion: doc.fechaCancelacion ? tsToDate(doc.fechaCancelacion) : undefined,
    esPrueba: doc.esPrueba === true,
    sucursalId,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
    syncStatus: 'synced',
  };
}

export async function createInvoiceFirestore(
  sucursalId: string,
  invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>
): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc: Record<string, unknown> = {
    ...invoice,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('invoices').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateInvoiceFirestore(
  sucursalId: string,
  invoiceId: string,
  updates: Partial<Invoice>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('invoices')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Factura no encontrada');
  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>) };
  Object.assign(doc, updates);
  doc.updatedAt = now;
  const { error } = await supabase
    .from('invoices')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', invoiceId);
  if (error) throw new Error(error.message);
}

export async function deleteInvoiceFirestore(sucursalId: string, invoiceId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('invoices').delete().eq('sucursal_id', sucursalId).eq('id', invoiceId);
  if (error) throw new Error(error.message);
}

export async function getInvoiceFirestore(
  sucursalId: string,
  invoiceId: string
): Promise<Invoice | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('invoices')
    .select('id, doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error || !data?.doc) return null;
  return mapInvoice(sucursalId, data.id, data.doc as Record<string, unknown>);
}

export function subscribeInvoicesCatalog(
  sucursalId: string,
  onData: (rows: Invoice[]) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase.from('invoices').select('id, doc').eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Invoices:', error);
      onData([]);
      return;
    }
    const list = (data ?? [])
      .map((r) => mapInvoice(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    onData(list);
  };
  void load();
  const ch = supabase
    .channel(`invoices-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'invoices', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
