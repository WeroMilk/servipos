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

/** Textos para preguntar la cantidad recibida al copiar un producto como plantilla (según unidad SAT). */
export function satUnidadLlegadaLabels(clave: string): {
  titulo: string;
  descripcionAyuda: string;
  inputLabel: string;
  permitirDecimal: boolean;
} {
  const c = normalizeClaveUnidadSat(clave);
  const row = SAT_CLAVES_UNIDAD.find((u) => u.clave === c);
  const desc = row?.descripcion ?? 'Unidad';
  switch (c) {
    case 'H87':
      return {
        titulo: '¿Cuántas piezas llegaron?',
        descripcionAyuda: `Unidad SAT: ${desc} (H87). Se suma a la existencia copiada del artículo plantilla (puede editarla después en «Stock inicial»).`,
        inputLabel: 'Piezas recibidas en esta recepción',
        permitirDecimal: false,
      };
    case 'MTR':
      return {
        titulo: '¿Cuántos metros llegaron?',
        descripcionAyuda: `Unidad SAT: ${desc} (MTR). Se suma a la existencia copiada del artículo plantilla.`,
        inputLabel: 'Metros recibidos en esta recepción',
        permitirDecimal: true,
      };
    case 'CMT':
      return {
        titulo: '¿Cuántos centímetros llegaron?',
        descripcionAyuda: `Unidad SAT: ${desc} (CMT). Se suma a la existencia copiada del artículo plantilla.`,
        inputLabel: 'Centímetros recibidos en esta recepción',
        permitirDecimal: true,
      };
    case 'E48':
    default:
      return {
        titulo: '¿Cuántas unidades llegaron?',
        descripcionAyuda: `Unidad SAT: ${desc} (${c}). Se suma a la existencia copiada del artículo plantilla.`,
        inputLabel: 'Unidades recibidas en esta recepción',
        permitirDecimal: false,
      };
  }
}

export function parseCantidadLlegadaSat(value: string, permitirDecimal: boolean): number {
  const t = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (t === '') return 0;
  if (permitirDecimal) {
    const n = parseFloat(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
  }
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Paso de +/- en carrito POS: medio metro; centímetro en entero. */
export function deltaCantidadBotonMasMenosSat(unidadMedida: string | undefined | null): number {
  const u = normalizeClaveUnidadSat(unidadMedida);
  if (u === 'MTR') return 0.5;
  if (u === 'CMT') return 1;
  return 1;
}

/** Cantidad válida por línea en ticket (PZ entero 1–9999; MTR/CMT con hasta 3 decimales). */
export function snapCantidadLineaVenta(unidadMedida: string | undefined | null, qtyRaw: number): number {
  const u = normalizeClaveUnidadSat(unidadMedida);
  if (u === 'MTR' || u === 'CMT') {
    const clamped = Math.min(999999, Math.max(0.001, Number(qtyRaw) || 0));
    return Math.round(clamped * 1000) / 1000;
  }
  return Math.min(9999, Math.max(1, Math.floor(Number(qtyRaw)) || 0));
}

/** Existencia en formulario inventario: enteros salvo metro/centímetro. */
export function parseExistenciaInventarioForm(value: string, unidadMedida: string): number {
  const u = normalizeClaveUnidadSat(unidadMedida);
  return parseCantidadLlegadaSat(value, u === 'MTR' || u === 'CMT');
}

/** Agrupa cantidad en línea POS / mensajes («pz» vs «m» / «cm»). */
export function abrevCantidadVentaPorUnidadSat(clave: string | undefined | null): string {
  switch (normalizeClaveUnidadSat(clave)) {
    case 'MTR':
      return 'm';
    case 'CMT':
      return 'cm';
    default:
      return 'pz';
  }
}

/** Texto estable para cantidad en carrito (decimales solo metro/cm). */
export function formatearCantidadLineaVentaSat(clave: string | undefined | null, qty: number): string {
  const u = normalizeClaveUnidadSat(clave);
  if (u === 'MTR' || u === 'CMT') {
    const r = Math.round(Math.max(0, qty) * 1000) / 1000;
    if (Number.isFinite(r) && Number.isInteger(r)) return String(r);
    const s = r.toFixed(3);
    return s.replace(/\.?0+$/, '');
  }
  return String(Math.max(1, Math.floor(qty)));
}
