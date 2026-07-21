import { normSkuBarcode } from '@/lib/productCatalogUniqueness';

/** Códigos por slot de ubicación física (muebles A / B / C). */
export const MUEBLE_POR_SLOT: Readonly<Record<string, readonly string[]>> = {
  A: [
    'w910010062',
    '1033',
    '1433',
    '606',
    '606',
    '2014',
    '560',
    '1474',
    '505',
  ],
  A1: [
    '2134',
    '1396',
    '1482',
    '1282',
    '1963',
    '1964',
    '799',
    '2275',
    '800',
    '1767',
    '801',
    '1700',
    '1948',
    '189',
    '189',
    '869',
  ],
  A2: [
    '2291',
    '2109',
    '1251',
    '119',
    '1067',
    '890',
    '1430',
    '1982',
    '105',
    '631',
  ],
  A3: [
    '226',
    '1438',
    '2095',
    '32',
    '1133',
    'w11198451',
    '1398',
    '1395',
    '2145',
  ],
  A4: ['632', '972', '60'],
  B: [
    '1279',
    '1228',
    '203',
    '898',
    '108',
    '1468',
    '2106',
    '1675',
    '1998',
    '1099',
    '1544',
  ],
  B1: ['1091', '394', '1567', '67'],
  B2: ['1164', '1394', '2088', '120', '120'],
  B3: ['1352', '1026', '880'],
  B4: ['1983', '7503033971215', '43'],
  C: ['1355'],
  C1: [
    '1621',
    '1621',
    '1804',
    '1804',
    '1500',
    '1569',
    '952',
    '952',
    '1542',
    '917',
    '1768',
    '18',
    '18',
    '2251',
  ],
  C2: [
    '1803',
    '1996',
    '603',
    '1970',
    '1134',
    '1135',
    '1624',
    '1427',
    '1882',
    '107',
    '2284',
    '1592',
    '2288',
    '2283',
  ],
  C3: ['1885', '1885', '1885', '30', '2223'],
  C4: [],
};

const SLOT_ORDER = [
  'A',
  'A1',
  'A2',
  'A3',
  'A4',
  'B',
  'B1',
  'B2',
  'B3',
  'B4',
  'C',
  'C1',
  'C2',
  'C3',
  'C4',
] as const;

/** Slots disponibles para asignar ubicación física a un producto. */
export const MUEBLE_SLOTS: readonly string[] = [...SLOT_ORDER];

/** Código normalizado → slots (sin duplicar el mismo slot). */
const CODIGO_A_UBICACIONES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const slot of SLOT_ORDER) {
    const codes = MUEBLE_POR_SLOT[slot] ?? [];
    for (const raw of codes) {
      const key = normSkuBarcode(raw);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, [slot]);
      } else if (!existing.includes(slot)) {
        existing.push(slot);
      }
    }
  }
  return map;
})();

/**
 * Ubicaciones físicas (muebles A–C) por SKU/código (mapa estático).
 */
export function getUbicacionesProducto(sku: string, codigoBarras?: string | null): string[] {
  const bySku = CODIGO_A_UBICACIONES.get(normSkuBarcode(sku));
  if (bySku?.length) return [...bySku];
  const barcode = (codigoBarras ?? '').trim();
  if (!barcode) return [];
  const byBarcode = CODIGO_A_UBICACIONES.get(normSkuBarcode(barcode));
  return byBarcode?.length ? [...byBarcode] : [];
}

/**
 * Ubicación efectiva: campo guardado en el producto, o inferencia por SKU del mapa.
 */
export function resolveUbicacionesProducto(product: {
  sku: string;
  codigoBarras?: string | null;
  ubicacionFisica?: string | null;
}): string[] {
  const saved = (product.ubicacionFisica ?? '').trim();
  if (saved) return [saved];
  return getUbicacionesProducto(product.sku, product.codigoBarras);
}
