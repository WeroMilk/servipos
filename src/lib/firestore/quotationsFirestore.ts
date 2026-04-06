import type { Quotation } from '@/types';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function parseQuotationStatus(v: unknown): Quotation['estado'] {
  const s = String(v ?? 'pendiente');
  if (s === 'pendiente' || s === 'aceptada' || s === 'rechazada' || s === 'vencida' || s === 'convertida') {
    return s;
  }
  return 'pendiente';
}

function mapQuotation(sucursalId: string, id: string, doc: Record<string, unknown>): Quotation {
  return {
    id,
    folio: String(doc.folio ?? ''),
    clienteId: String(doc.clienteId ?? ''),
    cliente:
      doc.cliente && typeof doc.cliente === 'object'
        ? (doc.cliente as Quotation['cliente'])
        : undefined,
    productos: Array.isArray(doc.productos) ? (doc.productos as Quotation['productos']) : [],
    subtotal: Number(doc.subtotal) || 0,
    descuento: Number(doc.descuento) || 0,
    impuestos: Number(doc.impuestos) || 0,
    total: Number(doc.total) || 0,
    vigenciaDias: Number(doc.vigenciaDias) || 0,
    fechaVigencia: tsToDate(doc.fechaVigencia),
    estado: parseQuotationStatus(doc.estado),
    notas: typeof doc.notas === 'string' ? doc.notas : undefined,
    usuarioId: String(doc.usuarioId ?? ''),
    usuarioNombre: typeof doc.usuarioNombre === 'string' ? doc.usuarioNombre : undefined,
    sucursalId,
    ventaId: typeof doc.ventaId === 'string' ? doc.ventaId : undefined,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
    syncStatus: 'synced',
  };
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function generateQuotationFolioFirestore(sucursalId: string): Promise<string> {
  const supabase = getSupabase();
  const now = new Date();
  const prefix = `C-${yyyymmdd(now)}`;
  const { data, error } = await supabase.from('quotations').select('doc').eq('sucursal_id', sucursalId);
  if (error) throw new Error(error.message);
  const count = (data ?? []).filter((r) =>
    String((r.doc as Record<string, unknown>)?.folio ?? '').startsWith(prefix)
  ).length;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

export async function createQuotationFirestore(
  sucursalId: string,
  quotation: Omit<Quotation, 'id' | 'folio' | 'createdAt' | 'updatedAt' | 'syncStatus'>
): Promise<Quotation> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const folio = await generateQuotationFolioFirestore(sucursalId);
  const doc: Record<string, unknown> = {
    ...quotation,
    folio,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('quotations').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return mapQuotation(sucursalId, id, doc);
}

export async function updateQuotationFirestore(
  sucursalId: string,
  quotationId: string,
  updates: Partial<Quotation>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('quotations')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', quotationId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Cotización no encontrada');
  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>) };
  Object.assign(doc, updates);
  doc.updatedAt = now;
  const { error } = await supabase
    .from('quotations')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', quotationId);
  if (error) throw new Error(error.message);
}

export async function deleteQuotationFirestore(sucursalId: string, quotationId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('quotations')
    .delete()
    .eq('sucursal_id', sucursalId)
    .eq('id', quotationId);
  if (error) throw new Error(error.message);
}

export function subscribeQuotationsCatalog(
  sucursalId: string,
  onData: (rows: Quotation[]) => void
): () => void {
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase
      .from('quotations')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Quotations:', error);
      onData([]);
      return;
    }
    const list = (data ?? [])
      .map((r) => mapQuotation(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    onData(list);
  };
  void load();
  const ch = supabase
    .channel(`quotations-${sucursalId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'quotations', filter: `sucursal_id=eq.${sucursalId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
