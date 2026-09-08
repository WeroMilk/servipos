const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/;

export function normalizeRfc(raw: string | undefined | null): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function isValidRfcSat(rfc: string): boolean {
  const r = normalizeRfc(rfc);
  if (r === 'XAXX010101000' || r === 'XEXX010101000') return true;
  if (r.length !== 12 && r.length !== 13) return false;
  return RFC_RE.test(r);
}

export function isValidCpMx(cp: string | undefined | null): boolean {
  return /^\d{5}$/.test(String(cp ?? '').trim());
}

export function assertReceiverFiscal(opts: {
  rfc?: string;
  name?: string;
  regimen?: string;
  taxZip?: string;
  expeditionPlace?: string;
}): { rfc: string; name: string; regimen: string; taxZip: string; expeditionPlace: string } {
  const rfc = normalizeRfc(opts.rfc);
  if (!rfc) throw new Error('El receptor debe tener RFC');
  if (!isValidRfcSat(rfc)) throw new Error(`RFC del receptor inválido: ${rfc}`);
  const name = String(opts.name ?? '')
    .trim()
    .toUpperCase();
  if (!name) throw new Error('El receptor debe tener nombre o razón social');
  const regimen = String(opts.regimen ?? '').trim();
  if (!regimen) throw new Error('El receptor debe tener régimen fiscal');
  const taxZip = String(opts.taxZip ?? '').trim();
  if (!isValidCpMx(taxZip)) throw new Error('El receptor debe tener código postal de 5 dígitos (TaxZipCode)');
  const expeditionPlace = String(opts.expeditionPlace ?? '').trim();
  if (!isValidCpMx(expeditionPlace)) {
    throw new Error('Falta lugar de expedición (código postal de 5 dígitos, igual a la sucursal en Facturama)');
  }
  return { rfc, name, regimen, taxZip, expeditionPlace };
}

/** PUE no usa forma 99; PPD sí requiere 99. */
export function assertPagoCfdi(metodoPago: string, formaPago: string): void {
  const metodo = String(metodoPago || 'PUE').trim().toUpperCase();
  const forma = String(formaPago || '01').trim();
  if (metodo === 'PUE' && forma === '99') {
    throw new Error('Método PUE no puede usar forma de pago 99 (por definir). Use PPD o una forma concreta.');
  }
  if (metodo === 'PPD' && forma !== '99') {
    throw new Error('Método PPD requiere forma de pago 99 (por definir)');
  }
}
