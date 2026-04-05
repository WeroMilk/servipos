import type { Direccion, FiscalConfig } from '@/types';
import { SERIE_FACTURA_PRUEBA, SERIE_NOMINA_PRUEBA } from '@/lib/fiscalConstants';
import { getSupabase } from '@/lib/supabaseClient';

export const FISCAL_CONFIG_DOC_ID = 'fiscal';

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

function readDireccion(d: unknown): Direccion | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const o = d as Record<string, unknown>;
  const codigoPostal = o.codigoPostal != null ? String(o.codigoPostal) : '';
  return {
    calle: o.calle != null ? String(o.calle) : undefined,
    numeroExterior: o.numeroExterior != null ? String(o.numeroExterior) : undefined,
    numeroInterior: o.numeroInterior != null ? String(o.numeroInterior) : undefined,
    colonia: o.colonia != null ? String(o.colonia) : undefined,
    codigoPostal,
    ciudad: o.ciudad != null ? String(o.ciudad) : undefined,
    municipio: o.municipio != null ? String(o.municipio) : undefined,
    estado: o.estado != null ? String(o.estado) : undefined,
    pais: o.pais != null ? String(o.pais) : 'México',
  };
}

export function fiscalDocToConfig(_sucursalId: string, raw: Record<string, unknown>): FiscalConfig {
  const folioActual = typeof raw.folioActual === 'number' ? raw.folioActual : Number(raw.folioActual) || 1;
  const folioNomina =
    raw.folioNominaActual != null
      ? typeof raw.folioNominaActual === 'number'
        ? raw.folioNominaActual
        : Number(raw.folioNominaActual) || 1
      : undefined;
  const folioPruebaFactura =
    raw.folioPruebaFactura != null
      ? typeof raw.folioPruebaFactura === 'number'
        ? raw.folioPruebaFactura
        : Number(raw.folioPruebaFactura) || 1
      : undefined;
  const folioPruebaNomina =
    raw.folioPruebaNomina != null
      ? typeof raw.folioPruebaNomina === 'number'
        ? raw.folioPruebaNomina
        : Number(raw.folioPruebaNomina) || 1
      : undefined;

  return {
    id: FISCAL_CONFIG_DOC_ID,
    rfc: String(raw.rfc ?? ''),
    razonSocial: String(raw.razonSocial ?? ''),
    regimenFiscal: String(raw.regimenFiscal ?? ''),
    codigoUsoCfdi: String(raw.codigoUsoCfdi ?? 'G03'),
    serie: String(raw.serie ?? 'A'),
    folioActual,
    serieNomina: raw.serieNomina != null ? String(raw.serieNomina) : undefined,
    folioNominaActual: folioNomina,
    modoPruebaFiscal: raw.modoPruebaFiscal === true,
    folioPruebaFactura,
    folioPruebaNomina,
    lugarExpedicion: String(raw.lugarExpedicion ?? ''),
    certificadoCsd: raw.certificadoCsd != null ? String(raw.certificadoCsd) : undefined,
    llavePrivadaCsd: raw.llavePrivadaCsd != null ? String(raw.llavePrivadaCsd) : undefined,
    contrasenaCsd: raw.contrasenaCsd != null ? String(raw.contrasenaCsd) : undefined,
    nombreComercial: raw.nombreComercial != null ? String(raw.nombreComercial) : undefined,
    telefono: raw.telefono != null ? String(raw.telefono) : undefined,
    email: raw.email != null ? String(raw.email) : undefined,
    direccion: readDireccion(raw.direccion),
    updatedAt: firestoreTimestampToDate(raw.updatedAt),
    preciosListaIncluyenIva:
      raw.preciosListaIncluyenIva === true
        ? true
        : raw.preciosListaIncluyenIva === false
          ? false
          : undefined,
  };
}

function toDocFields(config: Omit<FiscalConfig, 'id' | 'updatedAt'> | FiscalConfig): Record<string, unknown> {
  const o: Record<string, unknown> = {
    rfc: config.rfc ?? '',
    razonSocial: config.razonSocial ?? '',
    regimenFiscal: config.regimenFiscal ?? '',
    codigoUsoCfdi: config.codigoUsoCfdi ?? 'G03',
    serie: config.serie ?? 'A',
    folioActual: typeof config.folioActual === 'number' ? config.folioActual : Number(config.folioActual) || 1,
    lugarExpedicion: config.lugarExpedicion ?? '',
    modoPruebaFiscal: config.modoPruebaFiscal === true,
  };
  if (config.serieNomina !== undefined) o.serieNomina = config.serieNomina ?? null;
  if (config.folioNominaActual !== undefined) {
    o.folioNominaActual =
      typeof config.folioNominaActual === 'number' ? config.folioNominaActual : Number(config.folioNominaActual) || 1;
  }
  if (config.folioPruebaFactura !== undefined) {
    o.folioPruebaFactura =
      typeof config.folioPruebaFactura === 'number' ? config.folioPruebaFactura : Number(config.folioPruebaFactura) || 1;
  }
  if (config.folioPruebaNomina !== undefined) {
    o.folioPruebaNomina =
      typeof config.folioPruebaNomina === 'number' ? config.folioPruebaNomina : Number(config.folioPruebaNomina) || 1;
  }
  if (config.certificadoCsd !== undefined) o.certificadoCsd = config.certificadoCsd ?? null;
  if (config.llavePrivadaCsd !== undefined) o.llavePrivadaCsd = config.llavePrivadaCsd ?? null;
  if (config.contrasenaCsd !== undefined) o.contrasenaCsd = config.contrasenaCsd ?? null;
  if (config.nombreComercial !== undefined) o.nombreComercial = config.nombreComercial ?? null;
  if (config.telefono !== undefined) o.telefono = config.telefono ?? null;
  if (config.email !== undefined) o.email = config.email ?? null;
  if (config.preciosListaIncluyenIva !== undefined) {
    o.preciosListaIncluyenIva = config.preciosListaIncluyenIva;
  }
  if (config.direccion !== undefined) {
    o.direccion = config.direccion
      ? {
          calle: config.direccion.calle ?? null,
          numeroExterior: config.direccion.numeroExterior ?? null,
          numeroInterior: config.direccion.numeroInterior ?? null,
          colonia: config.direccion.colonia ?? null,
          codigoPostal: config.direccion.codigoPostal ?? '',
          ciudad: config.direccion.ciudad ?? null,
          municipio: config.direccion.municipio ?? null,
          estado: config.direccion.estado ?? null,
          pais: config.direccion.pais ?? 'México',
        }
      : null;
  }
  return o;
}

export async function getFiscalConfigFirestoreOnce(sucursalId: string): Promise<FiscalConfig | undefined> {
  const sid = sucursalId.trim();
  if (!sid) return undefined;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('fiscal_config')
    .select('doc')
    .eq('sucursal_id', sid)
    .eq('doc_id', FISCAL_CONFIG_DOC_ID)
    .maybeSingle();
  if (!data?.doc) return undefined;
  return fiscalDocToConfig(sid, data.doc as Record<string, unknown>);
}

export function subscribeFiscalConfigForSucursal(
  sucursalId: string,
  onData: (config: FiscalConfig | undefined) => void
): () => void {
  const sid = sucursalId.trim();
  if (!sid) {
    onData(undefined);
    return () => {};
  }
  const supabase = getSupabase();
  const load = async () => {
    const { data, error } = await supabase
      .from('fiscal_config')
      .select('doc')
      .eq('sucursal_id', sid)
      .eq('doc_id', FISCAL_CONFIG_DOC_ID)
      .maybeSingle();
    if (error) {
      console.error('fiscalConfig:', error);
      onData(undefined);
      return;
    }
    if (!data?.doc) {
      onData(undefined);
      return;
    }
    onData(fiscalDocToConfig(sid, data.doc as Record<string, unknown>));
  };
  void load();
  const ch = supabase
    .channel(`fiscal-${sid}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'fiscal_config',
        filter: `sucursal_id=eq.${sid}`,
      },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function saveFiscalConfigFirestore(
  sucursalId: string,
  config: Omit<FiscalConfig, 'id' | 'updatedAt'> | FiscalConfig
): Promise<string> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal para guardar la configuración fiscal en la nube');
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const fields = toDocFields(config);
  const doc = { ...fields, updatedAt: now };
  const { error } = await supabase.from('fiscal_config').upsert({
    sucursal_id: sid,
    doc_id: FISCAL_CONFIG_DOC_ID,
    doc,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return FISCAL_CONFIG_DOC_ID;
}

export async function incrementFolioActualOnlyFirestore(sucursalId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('rpc_increment_folio_actual_only', {
    p_sucursal_id: sucursalId.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function allocateNextInvoiceFolioFirestore(sucursalId: string): Promise<{ serie: string; folio: number }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_allocate_invoice_folio', { p_sucursal_id: sid });
  if (error) throw new Error(error.message);
  const o = data as { serie?: string; folio?: number };
  return { serie: o.serie ?? 'A', folio: o.folio ?? 1 };
}

export async function reservePruebaInvoiceFolioFirestore(
  sucursalId: string
): Promise<{ serie: string; folio: string }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_reserve_prueba_factura_folio', { p_sucursal_id: sid });
  if (error) throw new Error(error.message);
  const o = data as { serie?: string; folio?: string };
  return { serie: o.serie ?? SERIE_FACTURA_PRUEBA, folio: o.folio ?? '1' };
}

export async function reservePruebaNominaFolioFirestore(
  sucursalId: string
): Promise<{ serie: string; folio: string }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_reserve_prueba_nomina_folio', { p_sucursal_id: sid });
  if (error) throw new Error(error.message);
  const o = data as { serie?: string; folio?: string };
  return { serie: o.serie ?? SERIE_NOMINA_PRUEBA, folio: o.folio ?? '1' };
}
