import type { Invoice } from '@/types';
import { extractSelloFromCfdiXml } from '@/lib/facturama/client';

/**
 * URL de verificación oficial del SAT para el código bidimensional (QR) del CFDI.
 * @see https://www.sat.gob.mx/consultas/91447/nuevo-esquema-de-certificacion
 */
const SAT_VERIFICACION_BASE = 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx';

/** Total con 6 decimales para el parámetro `tt` del QR. */
export function formatTotalSatVerificacion(total: number): string {
  return total.toFixed(6);
}

/** Últimos 8 caracteres del sello digital del emisor (parámetro `fe`). */
export function selloDigitalUltimos8(sello: string | undefined | null): string | null {
  if (!sello || typeof sello !== 'string') return null;
  const t = sello.replace(/\s/g, '');
  if (t.length < 8) return null;
  return t.slice(-8);
}

export type SatVerificacionParams = {
  uuid: string;
  rfcEmisor: string;
  rfcReceptor: string;
  total: number;
  selloDigitalEmisor: string | undefined | null;
};

/**
 * Construye la URL que debe codificarse en el QR de una factura timbrada.
 * Sin UUID + sello válido no aplica (documento no timbrado).
 */
export function buildSatVerificacionCfdiUrl(p: SatVerificacionParams): string | null {
  const fe = selloDigitalUltimos8(p.selloDigitalEmisor);
  if (!fe) return null;
  const id = p.uuid.replace(/[{}]/gi, '').trim().toUpperCase();
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(id)) {
    return null;
  }
  const re = p.rfcEmisor.trim().toUpperCase();
  const rr = p.rfcReceptor.trim().toUpperCase();
  if (!re || !rr) return null;
  const tt = formatTotalSatVerificacion(p.total);
  const q = new URLSearchParams({ id, re, rr, tt, fe });
  return `${SAT_VERIFICACION_BASE}?${q.toString()}`;
}

/** UUID ficticio solo para QR de muestra (mismo formato que un timbre real). */
export const CFDI_MUESTRA_UUID = 'A1B2C3D4-E5F6-4A90-ABCD-EF1234567890';

/** Sello ficticio: los últimos 8 caracteres son el parámetro `fe` del QR oficial. */
const CFDI_MUESTRA_SELLO_EMISOR = 'CERTPRUEBA0123456789ABCDEF01234567';

/**
 * URL del portal de verificación del SAT para el QR (CBB).
 * Timbrada: UUID + RFC emisor/receptor + total + sello (o el sello extraído del XML).
 * Prueba local: QR de muestra.
 */
export function buildInvoiceCfdiQrUrl(inv: Invoice, rfcEmisorFallback?: string): string | null {
  const re = (inv.emisor?.rfc || rfcEmisorFallback || '').trim().toUpperCase();
  if (!re) return null;
  const rr = (inv.cliente?.rfc || 'XAXX010101000').trim().toUpperCase();
  const sello =
    String(inv.selloDigital ?? '').trim() ||
    (inv.xml ? extractSelloFromCfdiXml(inv.xml) : undefined);

  const uuid = inv.uuid?.replace(/[{}]/gi, '').trim();
  if (uuid) {
    const urlTimbrada = buildSatVerificacionCfdiUrl({
      uuid,
      rfcEmisor: re,
      rfcReceptor: rr,
      total: inv.total,
      selloDigitalEmisor: sello || CFDI_MUESTRA_SELLO_EMISOR,
    });
    if (urlTimbrada) return urlTimbrada;
  }

  if (!inv.esPrueba) return null;

  return buildSatVerificacionCfdiUrl({
    uuid: CFDI_MUESTRA_UUID,
    rfcEmisor: re,
    rfcReceptor: rr,
    total: inv.total,
    selloDigitalEmisor: CFDI_MUESTRA_SELLO_EMISOR,
  });
}

/** QR SAT real para nómina timbrada (o null si faltan datos). */
export function buildNominaCfdiQrUrl(args: {
  uuid?: string;
  selloDigital?: string;
  rfcEmisor: string;
  rfcReceptorTrabajador: string;
  totalNeto: number;
}): string | null {
  if (!args.uuid?.trim() || !args.selloDigital?.trim()) return null;
  return buildSatVerificacionCfdiUrl({
    uuid: args.uuid,
    rfcEmisor: args.rfcEmisor,
    rfcReceptor: args.rfcReceptorTrabajador,
    total: args.totalNeto,
    selloDigitalEmisor: args.selloDigital,
  });
}

/**
 * URL para el código bidimensional del recibo de nómina en **modo prueba** (Configuración), sin XML timbrado.
 * Usa UUID y sello de muestra; el portal del SAT no mostrará un CFDI válido hasta timbrar el XML con un PAC.
 */
export function buildNominaPruebaCfdiQrUrl(args: {
  rfcEmisor: string;
  rfcReceptorTrabajador: string;
  totalNeto: number;
}): string | null {
  const re = args.rfcEmisor.trim().toUpperCase();
  const rr = args.rfcReceptorTrabajador.trim().toUpperCase();
  if (!re || !rr) return null;
  return buildSatVerificacionCfdiUrl({
    uuid: CFDI_MUESTRA_UUID,
    rfcEmisor: re,
    rfcReceptor: rr,
    total: args.totalNeto,
    selloDigitalEmisor: CFDI_MUESTRA_SELLO_EMISOR,
  });
}
