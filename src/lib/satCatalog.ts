/**
 * Claves de unidad del catálogo SAT (c_ClaveUnidad) usadas en CFDI 4.0.
 * @see https://www.sat.gob.mx/consultas/92764/complemento-de-comercio-exterior-
 */
export const SAT_CLAVES_UNIDAD = [
  { clave: 'H87', descripcion: 'Pieza' },
  { clave: 'CMT', descripcion: 'Centímetro' },
  { clave: 'MTR', descripcion: 'Metro' },
  { clave: 'E48', descripcion: 'Unidad de servicio' },
] as const;

export type SatClaveUnidad = (typeof SAT_CLAVES_UNIDAD)[number]['clave'];

const SAT_UNIDAD_SET = new Set<string>(SAT_CLAVES_UNIDAD.map((u) => u.clave));

/** Normaliza texto legado o vacío a una clave SAT válida para factura. */
export function normalizeClaveUnidadSat(raw: string | undefined | null): SatClaveUnidad {
  const u = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (SAT_UNIDAD_SET.has(u)) return u as SatClaveUnidad;
  const p = u.replace(/\s+/g, '');
  if (['PZA', 'PZ', 'PIEZA', 'PIEZAS', 'PZA.', 'UND', 'UNIDAD'].includes(p)) return 'H87';
  if (['CM', 'CMS', 'CENTIMETRO', 'CENTÍMETRO'].includes(p)) return 'CMT';
  if (['MT', 'MTS', 'METRO', 'METROS'].includes(p)) return 'MTR';
  if (['SERV', 'SERVICIO', 'SERVICIOS'].includes(p)) return 'E48';
  return 'H87';
}

/** Clave Producto/Servicio SAT: 8 dígitos. */
export function normalizeClaveProdServ(raw: string | undefined | null): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 8);
}

export function isValidClaveProdServSat(value: string | undefined | null): boolean {
  return /^\d{8}$/.test(String(value ?? '').trim());
}
