/** Heurística import Olivares: cable/tubo/cinta vendido por metro (SAT MTR vs H87 pieza). */

const RE_INSTRUMENTO =
  /\b(FLEXOMETRO|MULTIMETRO|MANOMETRO|TERMOMETRO|VACUOMETRO|HIGROMETRO)\b/iu;

/**
 * Si el nombre indica venta por metro según convención de catálogo (METRO … o … METRO).
 * @returns {'MTR'|null}
 */
export function inferUnidadMetrosNombreSat(nombre) {
  const u = String(nombre ?? '').trim().toUpperCase();
  if (!u || RE_INSTRUMENTO.test(u)) return null;
  if (/^METRO\s/u.test(u)) return 'MTR';
  if (/\sMETRO$/u.test(u)) return 'MTR';
  return null;
}

/**
 * @param {string|undefined|null} nombre
 * @param {string|undefined|null} categoria
 * @param {string|undefined|null} [prevUnidad] — valor ya guardado en Supabase/Dexie
 * @returns {'E48'|'MTR'|'H87'}
 */
export function unidadSatProductoOlivares(nombre, categoria, prevUnidad = undefined) {
  const cat = String(categoria ?? '').trim().toUpperCase();
  if (cat === 'SERVICIOS') return 'E48';
  const inferred = inferUnidadMetrosNombreSat(nombre);
  if (inferred) return inferred;
  const p = String(prevUnidad ?? '').trim().toUpperCase();
  if (p === 'MTR' || p === 'CMT' || p === 'E48' || p === 'H87') return p;
  return 'H87';
}
