import type { CajaRetiroEfectivo, CajaSesion } from '@/types';
import {
  computeCajaEfectivoEsperado,
  efectivoEsperadoMenosRetiros,
  filterVentasCompletadasSesion,
  resumenBrutoSesion,
} from '@/lib/cajaResumen';
import { fetchSalesByCajaSesion } from '@/lib/firestore/salesFirestore';
import { getSupabase } from '@/lib/supabaseClient';

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

function parseRetirosEfectivoFirestore(raw: unknown): CajaRetiroEfectivo[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CajaRetiroEfectivo[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? '');
    const monto = Number(o.monto) || 0;
    if (!id || monto <= 0) continue;
    out.push({
      id,
      monto,
      notas: o.notas != null && String(o.notas).trim() ? String(o.notas).trim() : undefined,
      createdAt: firestoreTimestampToDate(o.createdAt),
      usuarioId: String(o.usuarioId ?? ''),
      usuarioNombre: String(o.usuarioNombre ?? ''),
    });
  }
  return out.length > 0 ? out : undefined;
}

function mapCajaSesionDoc(sucursalId: string, sesionId: string, d: Record<string, unknown>): CajaSesion {
  return {
    id: sesionId,
    estado: d.estado === 'cerrada' ? 'cerrada' : 'abierta',
    fondoInicial: Number(d.fondoInicial) || 0,
    retirosEfectivoTotal:
      d.retirosEfectivoTotal != null ? Number(d.retirosEfectivoTotal) || 0 : undefined,
    retirosEfectivo: parseRetirosEfectivoFirestore(d.retirosEfectivo),
    openedAt: firestoreTimestampToDate(d.openedAt),
    openedByUserId: String(d.openedByUserId ?? ''),
    openedByNombre: String(d.openedByNombre ?? ''),
    closedAt: d.closedAt != null ? firestoreTimestampToDate(d.closedAt) : undefined,
    closedByUserId: d.closedByUserId != null ? String(d.closedByUserId) : undefined,
    closedByNombre: d.closedByNombre != null ? String(d.closedByNombre) : undefined,
    conteoDeclarado: d.conteoDeclarado != null ? Number(d.conteoDeclarado) : undefined,
    efectivoEsperado: d.efectivoEsperado != null ? Number(d.efectivoEsperado) : undefined,
    diferencia: d.diferencia != null ? Number(d.diferencia) : undefined,
    notasCierre: d.notasCierre != null ? String(d.notasCierre) : undefined,
    ticketsCompletados: d.ticketsCompletados != null ? Number(d.ticketsCompletados) : undefined,
    totalVentasBruto: d.totalVentasBruto != null ? Number(d.totalVentasBruto) : undefined,
    sucursalId,
  };
}

export function subscribeCajaSesionAbierta(
  sucursalId: string,
  cb: (session: CajaSesion | null) => void
): () => void {
  const supabase = getSupabase();
  let unsubSes: (() => void) | null = null;

  const loadSesion = (openId: string) => {
    unsubSes?.();
    unsubSes = null;
    if (!openId) {
      cb(null);
      return;
    }
    const load = async () => {
      const { data } = await supabase
        .from('caja_sesiones')
        .select('id, doc')
        .eq('sucursal_id', sucursalId)
        .eq('id', openId)
        .maybeSingle();
      if (!data?.doc) {
        cb(null);
        return;
      }
      const mapped = mapCajaSesionDoc(sucursalId, data.id, data.doc as Record<string, unknown>);
      cb(mapped.estado === 'abierta' ? mapped : null);
    };
    void load();
    const ch = supabase
      .channel(`caja-ses-${sucursalId}-${openId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'caja_sesiones',
          filter: `id=eq.${openId}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();
    unsubSes = () => {
      void supabase.removeChannel(ch);
    };
  };

  const loadEstado = async () => {
    const { data } = await supabase
      .from('caja_estado')
      .select('doc')
      .eq('sucursal_id', sucursalId)
      .eq('doc_id', 'current')
      .maybeSingle();
    const openIdRaw = data?.doc ? (data.doc as { sesionAbiertaId?: string }).sesionAbiertaId : null;
    const openId = typeof openIdRaw === 'string' ? openIdRaw.trim() : '';
    loadSesion(openId);
  };

  void loadEstado();
  const chEst = supabase
    .channel(`caja-est-${sucursalId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'caja_estado',
        filter: `sucursal_id=eq.${sucursalId}`,
      },
      () => {
        void loadEstado();
      }
    )
    .subscribe();

  return () => {
    unsubSes?.();
    void supabase.removeChannel(chEst);
  };
}

export async function openCajaSessionFirestore(
  sucursalId: string,
  input: {
    fondoInicial: number;
    openedByUserId: string;
    openedByNombre: string;
  }
): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_open_caja_session', {
    p_sucursal_id: sucursalId,
    p_fondo_inicial: input.fondoInicial,
    p_opened_by_user_id: input.openedByUserId,
    p_opened_by_nombre: input.openedByNombre,
  });
  if (error) throw new Error(error.message);
  const o = data as { id?: string };
  if (!o?.id) throw new Error('Sesión no creada');
  return { id: o.id };
}

export async function closeCajaSessionFirestore(
  sucursalId: string,
  sesionId: string,
  input: {
    conteoDeclarado: number;
    notasCierre?: string;
    closedByUserId: string;
    closedByNombre: string;
  }
): Promise<void> {
  const sid = sesionId.trim();
  if (!sid) throw new Error('Sesión inválida');

  const ventas = await fetchSalesByCajaSesion(sucursalId, sid);
  const completadas = filterVentasCompletadasSesion(ventas);
  const { tickets, total } = resumenBrutoSesion(ventas);

  const { data: sRow } = await getSupabase()
    .from('caja_sesiones')
    .select('doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', sid)
    .maybeSingle();
  if (!sRow?.doc) throw new Error('Sesión de caja no encontrada');
  const data = sRow.doc as Record<string, unknown>;
  if (data.estado !== 'abierta') throw new Error('Esta sesión de caja ya está cerrada');

  const fondo = Number(data.fondoInicial) || 0;
  const retirosTotal = Number(data.retirosEfectivoTotal) || 0;
  const { esperadoEnCaja: esperadoBruto } = computeCajaEfectivoEsperado(fondo, completadas);
  const esperadoEnCaja = efectivoEsperadoMenosRetiros(esperadoBruto, retirosTotal);
  const declarado = Number(input.conteoDeclarado);
  if (!Number.isFinite(declarado) || declarado < 0) {
    throw new Error('Indique un conteo de efectivo válido');
  }

  const supabase = getSupabase();
  const { error } = await supabase.rpc('rpc_close_caja_session', {
    p_sucursal_id: sucursalId,
    p_sesion_id: sid,
    p_conteo_declarado: declarado,
    p_notas: input.notasCierre ?? null,
    p_closed_by_user_id: input.closedByUserId,
    p_closed_by_nombre: input.closedByNombre,
    p_efectivo_esperado: esperadoEnCaja,
    p_tickets: tickets,
    p_total_ventas_bruto: total,
  });
  if (error) throw new Error(error.message);
}

export async function getCajaSesionFirestore(
  sucursalId: string,
  sesionId: string
): Promise<CajaSesion | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('caja_sesiones')
    .select('id, doc')
    .eq('sucursal_id', sucursalId)
    .eq('id', sesionId.trim())
    .maybeSingle();
  if (!data?.doc) return null;
  return mapCajaSesionDoc(sucursalId, data.id, data.doc as Record<string, unknown>);
}

export async function registrarRetiroEfectivoFirestore(
  sucursalId: string,
  sesionId: string,
  input: {
    monto: number;
    notas?: string;
    usuarioId: string;
    usuarioNombre: string;
  }
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('rpc_registrar_retiro_caja', {
    p_sucursal_id: sucursalId,
    p_sesion_id: sesionId.trim(),
    p_monto: input.monto,
    p_notas: input.notas ?? null,
    p_usuario_id: input.usuarioId,
    p_usuario_nombre: input.usuarioNombre,
  });
  if (error) throw new Error(error.message);
}
