/**
 * Catálogo reducido para flujo Estado → Municipio → CP → colonia/calle.
 * Para cobertura nacional completa habría que integrar SEPOMEX u otro servicio.
 */

export const ESTADO_SONORA = 'Sonora';

/** Municipios de Sonora (principales + lista ampliada). */
export const MUNICIPIOS_SONORA: string[] = [
  'Aconchi',
  'Agua Prieta',
  'Álamos',
  'Altar',
  'Arivechi',
  'Arizpe',
  'Atil',
  'Bacadéhuachi',
  'Bacanora',
  'Bacerac',
  'Bacoachi',
  'Bácum',
  'Banámichi',
  'Baviácora',
  'Bavispe',
  'Benjamín Hill',
  'Caborca',
  'Cajeme',
  'Cananea',
  'Carbó',
  'La Colorada',
  'Cucurpe',
  'Cumpas',
  'Divisaderos',
  'Empalme',
  'Etchojoa',
  'Fronteras',
  'Granados',
  'Guaymas',
  'Hermosillo',
  'Huachinera',
  'Huásabas',
  'Huatabampo',
  'Huépac',
  'Imuris',
  'Magdalena',
  'Mazatán',
  'Moctezuma',
  'Naco',
  'Nacori Chico',
  'Navojoa',
  'Nogales',
  'Onavas',
  'Opodepe',
  'Oquitoa',
  'Pitiquito',
  'Puerto Peñasco',
  'Quiriego',
  'Rayón',
  'Rosario',
  'Sahuaripa',
  'San Felipe de Jesús',
  'San Ignacio Río Muerto',
  'San Javier',
  'San Luis Río Colorado',
  'San Miguel de Horcasitas',
  'San Pedro de la Cueva',
  'Santa Ana',
  'Santa Cruz',
  'Sáric',
  'Soyopa',
  'Suaqui Grande',
  'Tepache',
  'Trincheras',
  'Tubutama',
  'Ures',
  'Villa Hidalgo',
  'Villa Pesqueira',
  'Yécora',
].sort((a, b) => a.localeCompare(b, 'es'));

export type CpEntry = {
  municipio: string;
  ciudad: string;
  colonias: string[];
  /** Calles frecuentes de ejemplo; el usuario puede escribir otra. */
  calles: string[];
};

export const CP_CATALOG: Record<string, CpEntry> = {
  '83000': {
    municipio: 'Hermosillo',
    ciudad: 'Hermosillo',
    colonias: ['Centro', 'Modelo', 'San Benito', 'Villa de Seris'],
    calles: ['Comonfort', 'Hidalgo', 'Matamoros', 'Rosales'],
  },
  '83010': {
    municipio: 'Hermosillo',
    ciudad: 'Hermosillo',
    colonias: ['5 de Mayo', 'Villa Satélite', 'Y Griega', 'El Llano'],
    calles: ['Veracruz', 'Jalisco', 'Sonora', 'Chiapas'],
  },
  '83100': {
    municipio: 'Hermosillo',
    ciudad: 'Hermosillo',
    colonias: ['Bellavista', 'Casa Blanca', 'Los Olivos'],
    calles: ['Blvd. Luis Encinas', 'Blvd. Solidaridad', 'Periférico Norte'],
  },
  '83200': {
    municipio: 'Hermosillo',
    ciudad: 'Hermosillo',
    colonias: ['Centenario', 'Altares', 'El Sahuaro'],
    calles: ['Blvd. García Morales', 'Prol. Hidalgo'],
  },
  '84000': {
    municipio: 'Nogales',
    ciudad: 'Nogales',
    colonias: ['Centro', 'Bella Vista', 'Industrial'],
    calles: ['Internacional', 'Obregón', 'Calle 5'],
  },
  '85000': {
    municipio: 'Cajeme',
    ciudad: 'Ciudad Obregón',
    colonias: ['Centro', 'Zona Norte', 'Nuevo Cajeme'],
    calles: ['Hidalgo', 'Juárez', 'Miguel Alemán'],
  },
  '85400': {
    municipio: 'Guaymas',
    ciudad: 'Guaymas',
    colonias: ['Centro', 'San Carlos', 'Empalme'],
    calles: ['Serdán', 'Calle 14', 'Blvd. Manlio Fabio Beltrones'],
  },
  '85800': {
    municipio: 'Navojoa',
    ciudad: 'Navojoa',
    colonias: ['Centro', '5 de Mayo', 'Nuevo Navojoa'],
    calles: ['Juárez', 'Serdán', '5 de Febrero'],
  },
};

export function normalizeCp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 5);
}

export function lookupCp(raw: string): CpEntry | null {
  const k = normalizeCp(raw);
  return CP_CATALOG[k] ?? null;
}
