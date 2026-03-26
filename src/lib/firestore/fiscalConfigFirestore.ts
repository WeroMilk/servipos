import {
  doc,
  getDoc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SERIE_FACTURA_PRUEBA, SERIE_NOMINA_PRUEBA } from '@/lib/fiscalConstants';
import type { Direccion, FiscalConfig } from '@/types';

const COL = 'sucursales';
const CONFIG_SUB = 'config';
export const FISCAL_CONFIG_DOC_ID = 'fiscal';

export function fiscalConfigDocRef(sucursalId: string) {
  return doc(db, COL, sucursalId.trim(), CONFIG_SUB, FISCAL_CONFIG_DOC_ID);
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
  };
}

/** Payload sin undefined (Firestore ignora undefined en merge). */
function toFirestoreFields(
  config: Omit<FiscalConfig, 'id' | 'updatedAt'> | FiscalConfig
): Record<string, unknown> {
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
  const snap = await getDoc(fiscalConfigDocRef(sid));
  if (!snap.exists()) return undefined;
  return fiscalDocToConfig(sid, snap.data() as Record<string, unknown>);
}

export function subscribeFiscalConfigForSucursal(
  sucursalId: string,
  onData: (config: FiscalConfig | undefined) => void
): Unsubscribe {
  const sid = sucursalId.trim();
  if (!sid) {
    onData(undefined);
    return () => {};
  }
  return onSnapshot(
    fiscalConfigDocRef(sid),
    (snap) => {
      if (!snap.exists()) {
        onData(undefined);
        return;
      }
      onData(fiscalDocToConfig(sid, snap.data() as Record<string, unknown>));
    },
    (err) => {
      console.error('fiscalConfig:', err);
      onData(undefined);
    }
  );
}

export async function saveFiscalConfigFirestore(
  sucursalId: string,
  config: Omit<FiscalConfig, 'id' | 'updatedAt'> | FiscalConfig
): Promise<string> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal para guardar la configuración fiscal en la nube');
  const ref = fiscalConfigDocRef(sid);
  const fields = toFirestoreFields(config);
  await setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true });
  return FISCAL_CONFIG_DOC_ID;
}

/** Reserva el folio actual y avanza `folioActual` en una sola transacción (evita duplicados entre dispositivos). */
/** Sube `folioActual` en 1 (p. ej. si ya se emitió el CFDI con el folio leído aparte). */
export async function incrementFolioActualOnlyFirestore(sucursalId: string): Promise<void> {
  const ref = fiscalConfigDocRef(sucursalId.trim());
  await updateDoc(ref, {
    folioActual: increment(1),
    updatedAt: serverTimestamp(),
  });
}

export async function allocateNextInvoiceFolioFirestore(sucursalId: string): Promise<{ serie: string; folio: number }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const ref = fiscalConfigDocRef(sid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('No hay configuración fiscal');
    const d = snap.data() as Record<string, unknown>;
    const serie = String(d.serie ?? 'A');
    const n = typeof d.folioActual === 'number' ? d.folioActual : Number(d.folioActual) || 1;
    tx.set(
      ref,
      {
        folioActual: n + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { serie, folio: n };
  });
}

export async function reservePruebaInvoiceFolioFirestore(
  sucursalId: string
): Promise<{ serie: string; folio: string }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const ref = fiscalConfigDocRef(sid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('No hay configuración fiscal');
    const d = snap.data() as Record<string, unknown>;
    const n = typeof d.folioPruebaFactura === 'number' ? d.folioPruebaFactura : Number(d.folioPruebaFactura) || 1;
    tx.set(
      ref,
      {
        folioPruebaFactura: n + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { serie: SERIE_FACTURA_PRUEBA, folio: String(n) };
  });
}

export async function reservePruebaNominaFolioFirestore(
  sucursalId: string
): Promise<{ serie: string; folio: string }> {
  const sid = sucursalId.trim();
  if (!sid) throw new Error('No hay sucursal');
  const ref = fiscalConfigDocRef(sid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('No hay configuración fiscal');
    const d = snap.data() as Record<string, unknown>;
    const n = typeof d.folioPruebaNomina === 'number' ? d.folioPruebaNomina : Number(d.folioPruebaNomina) || 1;
    tx.set(
      ref,
      {
        folioPruebaNomina: n + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { serie: SERIE_NOMINA_PRUEBA, folio: String(n) };
  });
}
