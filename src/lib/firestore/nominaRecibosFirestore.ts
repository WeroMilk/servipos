import type { NominaRecibo } from '@/types';
import { createDebouncedAsyncFn } from '@/lib/debouncedAsync';
import { getSupabase } from '@/lib/supabaseClient';

function tsToDate(v: unknown): Date {
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (v instanceof Date) return v;
  return new Date();
}

function parseEstado(v: unknown): NominaRecibo['estado'] {
  const s = String(v ?? 'borrador');
  if (s === 'borrador' || s === 'timbrada' || s === 'cancelada' || s === 'error') return s;
  return 'borrador';
}

function mapRecibo(sucursalId: string, id: string, doc: Record<string, unknown>): NominaRecibo {
  return {
    id,
    empleadoId: String(doc.empleadoId ?? ''),
    empleado: doc.empleado && typeof doc.empleado === 'object' ? (doc.empleado as NominaRecibo['empleado']) : undefined,
    serie: String(doc.serie ?? ''),
    folio: String(doc.folio ?? ''),
    tipoNomina: doc.tipoNomina === 'E' ? 'E' : 'O',
    fechaPago: String(doc.fechaPago ?? ''),
    fechaInicialPago: String(doc.fechaInicialPago ?? ''),
    fechaFinalPago: String(doc.fechaFinalPago ?? ''),
    numDiasPagados: Number(doc.numDiasPagados) || 0,
    formaPago: String(doc.formaPago ?? '99'),
    lugarExpedicion: String(doc.lugarExpedicion ?? ''),
    percepciones: Array.isArray(doc.percepciones) ? (doc.percepciones as NominaRecibo['percepciones']) : [],
    deducciones: Array.isArray(doc.deducciones) ? (doc.deducciones as NominaRecibo['deducciones']) : [],
    otrosPagos: Array.isArray(doc.otrosPagos) ? (doc.otrosPagos as NominaRecibo['otrosPagos']) : [],
    totalPercepciones: Number(doc.totalPercepciones) || 0,
    totalDeducciones: Number(doc.totalDeducciones) || 0,
    totalOtrosPagos: Number(doc.totalOtrosPagos) || 0,
    neto: Number(doc.neto) || 0,
    estado: parseEstado(doc.estado),
    uuid: typeof doc.uuid === 'string' ? doc.uuid : undefined,
    facturamaId: typeof doc.facturamaId === 'string' ? doc.facturamaId : undefined,
    fechaTimbrado: doc.fechaTimbrado ? tsToDate(doc.fechaTimbrado) : undefined,
    selloDigital: typeof doc.selloDigital === 'string' ? doc.selloDigital : undefined,
    xml: typeof doc.xml === 'string' ? doc.xml : undefined,
    motivoCancelacion: typeof doc.motivoCancelacion === 'string' ? doc.motivoCancelacion : undefined,
    fechaCancelacion: doc.fechaCancelacion ? tsToDate(doc.fechaCancelacion) : undefined,
    acuseCancelacion: typeof doc.acuseCancelacion === 'string' ? doc.acuseCancelacion : undefined,
    esPrueba: doc.esPrueba === true,
    sucursalId,
    createdAt: tsToDate(doc.createdAt),
    updatedAt: tsToDate(doc.updatedAt),
  };
}

export async function createNominaReciboFirestore(
  sucursalId: string,
  recibo: Omit<NominaRecibo, 'id' | 'createdAt' | 'updatedAt' | 'sucursalId'>
): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc: Record<string, unknown> = { ...recibo, createdAt: now, updatedAt: now };
  const { error } = await supabase.from('nomina_recibos').insert({
    sucursal_id: sucursalId,
    id,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateNominaReciboFirestore(
  sucursalId: string,
  reciboId: string,
  updates: Partial<NominaRecibo>
): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('nomina_recibos')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', reciboId)
    .maybeSingle();
  if (!row?.doc) throw new Error('Recibo no encontrado');
  const now = new Date().toISOString();
  const doc = { ...(row.doc as Record<string, unknown>), ...updates, updatedAt: now };
  const { error } = await supabase
    .from('nomina_recibos')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', sucursalId)
    .eq('id', reciboId);
  if (error) throw new Error(error.message);
}

export async function getNominaReciboFirestore(
  sucursalId: string,
  reciboId: string
): Promise<NominaRecibo | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('nomina_recibos')
    .select('id, doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', reciboId)
    .maybeSingle();
  if (error || !data?.doc) return null;
  return mapRecibo(sucursalId, data.id, data.doc as Record<string, unknown>);
}

let lastRecibos: NominaRecibo[] = [];
const listeners = new Set<(rows: NominaRecibo[]) => void>();
let channel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
let sid: string | null = null;
let reloadDebounced: (() => void) | null = null;

export function subscribeNominaRecibosCatalog(
  sucursalId: string,
  onData: (rows: NominaRecibo[]) => void
): () => void {
  onData([...lastRecibos]);
  listeners.add(onData);
  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase
      .from('nomina_recibos')
      .select('id, doc')
      .eq('sucursal_id', sucursalId);
    if (error) {
      console.error('Nomina:', error);
      return;
    }
    lastRecibos = (data ?? [])
      .map((r) => mapRecibo(sucursalId, r.id, r.doc as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    listeners.forEach((l) => {
      try {
        l([...lastRecibos]);
      } catch (e) {
        console.error(e);
      }
    });
  };

  if (sid !== sucursalId) {
    if (channel) void supabase.removeChannel(channel);
    sid = sucursalId;
    reloadDebounced = createDebouncedAsyncFn(load, 500);
    lastRecibos = [];
    void load();
    channel = supabase
      .channel(`nomina-${sucursalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nomina_recibos',
          filter: `sucursal_id=eq.${sucursalId}`,
        },
        () => reloadDebounced?.()
      )
      .subscribe();
  } else {
    onData([...lastRecibos]);
  }

  return () => {
    listeners.delete(onData);
  };
}

export async function allocateNominaFolioFirestore(
  sucursalId: string
): Promise<{ serie: string; folio: number }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_allocate_nomina_folio', {
    p_sucursal_id: sucursalId,
  });
  if (error) throw new Error(error.message);
  const row = data as { serie?: string; folio?: number };
  return {
    serie: String(row?.serie ?? 'N'),
    folio: Number(row?.folio) || 1,
  };
}
