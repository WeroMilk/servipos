/**
 * Lista de precios RTF (Crystal) + reglas Cananea / regular / técnico / mayoreo.
 * Usado por merge-olivares-precios-rtf.mjs e import-olivares-to-supabase.mjs.
 */

import { readFileSync } from 'node:fs';

export const LIST_KEYS = ['regular', 'tecnico', 'cananea', 'mayoreo_menos', 'mayoreo_mas'];

/** Precio con IVA en pesos tiene centavos distintos de .00 */
function conIvaTieneCentavos(p) {
  const cents = Math.round(Number(p) * 100) % 100;
  return cents !== 0;
}

/**
 * Cinco precios con IVA → mapa por lista (mismas claves que la app).
 *
 * Reglas de negocio (resumen):
 * - Cananea: precio con centavos (ej. $22.45); empates → el menor; sin centavos → el menor de los cinco.
 * - Regular: el más caro entre los cuatro restantes.
 * - Técnico: el siguiente (2.º más caro).
 * - Mayoreo −: segundo más barato (mayoreo_menos).
 * - Mayoreo +: el más barato (mayoreo_mas).
 */
export function mapFiveConIvaPricesToLists(pricesConIva) {
  const arr = pricesConIva.slice(0, 5);
  if (arr.length < 5 || arr.some((p) => !Number.isFinite(Number(p)) || Number(p) < 0)) {
    return null;
  }

  const indexed = arr.map((price, index) => ({ price: Number(price), index }));
  const withCents = indexed.filter((x) => conIvaTieneCentavos(x.price));

  let cananeaPick;
  if (withCents.length === 1) {
    cananeaPick = withCents[0];
  } else if (withCents.length > 1) {
    cananeaPick = withCents.reduce((a, b) => (a.price <= b.price ? a : b));
  } else {
    cananeaPick = indexed.reduce((a, b) => (a.price <= b.price ? a : b));
  }

  const cananea = cananeaPick.price;
  const rest = indexed.filter((x) => x.index !== cananeaPick.index).map((x) => x.price);
  rest.sort((a, b) => b - a);

  return {
    regular: rest[0],
    tecnico: rest[1],
    mayoreo_menos: rest[2],
    mayoreo_mas: rest[3],
    cananea,
  };
}

export function normSkuKey(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es-MX');
}

export function normNombreKey(s) {
  return String(s ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('es-MX')
    .replace(/\s+/g, ' ');
}

export function normNombreKeyLoose(s) {
  return normNombreKey(s)
    .replace(/Ñ/g, 'N')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRtfPictBlocks(rtf) {
  let s = rtf;
  let i = 0;
  while ((i = s.indexOf('{\\pict')) !== -1) {
    let depth = 0;
    let j = i;
    while (j < s.length) {
      const c = s[j];
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      j++;
    }
    s = s.slice(0, i) + s.slice(j);
  }
  return s;
}

function rtfDecodeName(s) {
  return s
    .replace(/\\u(\d+)\s*\?/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\\/g, '\\')
    .replace(/\\par/g, ' ')
    .trim();
}

function extractNombreProducto(block) {
  const m0 = block.match(/\\cf0\\cf1\\b\s+([^\\]+?)\s*\\par/);
  if (m0) {
    const t = rtfDecodeName(m0[1]);
    if (t && !/^c[oó]digo/i.test(t)) return t;
  }
  const all = [...block.matchAll(/\\cf1\\b\s+([^\\]+?)\s*\\par/g)];
  for (const x of all) {
    const t = rtfDecodeName(x[1]);
    if (t && !/^c[oó]digo/i.test(t) && t.length > 2) return t;
  }
  return '';
}

function parseMxDateTime(str) {
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, mo, d, y, hh, mm, ss] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
}

/** `t` es marca de tiempo real (ms), no índice secuencial del RTF. */
function isRealTimestampMs(t) {
  return typeof t === 'number' && t > 946684800000; // > 2000-01-01
}

/**
 * Elige los 5 importes con IVA que alimentan `mapFiveConIvaPricesToLists`:
 * - Con fechas en el bloque: se usa el **día calendario más reciente**; dentro de ese día, las **últimas 5** capturas (por hora).
 * - Si ese día tiene menos de 5 líneas, se completan con las capturas **inmediatamente anteriores** en el tiempo hasta llegar a 5.
 * - Sin fechas parseables: orden del RTF y se toman las **últimas 5** líneas con precio.
 * - Si tras lo anterior hay **menos de 5** valores (p. ej. el RTF solo trae una línea nueva),
 *   con `pad5` se repite el **último** precio de la secuencia hasta completar 5 (por defecto en `parsePreciosRtf`).
 */
function pickFivePricesFromRows(rows, pad5) {
  if (rows.length === 0) return null;

  const real = rows.filter((r) => isRealTimestampMs(r.t));
  const bySeq = [...rows].sort((a, b) => a.t - b.t);

  let chosen = [];

  if (real.length === 0) {
    chosen = bySeq.map((r) => r.price).slice(-5);
  } else {
    const sortedAll = [...real].sort((a, b) => a.t - b.t);
    const maxT = sortedAll[sortedAll.length - 1].t;
    const maxD = new Date(maxT);
    const dayStart = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate()).getTime();
    const dayEnd = dayStart + 86400000;

    const sameDay = sortedAll.filter((r) => r.t >= dayStart && r.t < dayEnd);

    if (sameDay.length >= 5) {
      chosen = sameDay.slice(-5).map((r) => r.price);
    } else if (sameDay.length > 0) {
      const before = sortedAll.filter((r) => r.t < dayStart);
      const merged = [...before, ...sameDay];
      chosen = merged.slice(-5).map((r) => r.price);
    } else {
      chosen = sortedAll.slice(-5).map((r) => r.price);
    }
  }

  if (chosen.length < 5 && pad5 && chosen.length > 0) {
    const last = chosen[chosen.length - 1];
    while (chosen.length < 5) chosen.push(last);
  }

  return chosen.length >= 5 ? chosen : null;
}

/**
 * @returns {Map<string, { nombre: string, preciosConIva: Record<string, number> }>}
 */
export function parsePreciosRtf(rtfText, opts = {}) {
  /** Por defecto sí: Crystal a veces exporta pocas líneas si solo cambió un importe. */
  const pad5 = opts.pad5 !== false;
  const s = stripRtfPictBlocks(rtfText);
  const map = new Map();

  const skuRe = /\\cf1\s+(\d{1,14})\s*\\par/g;
  const hits = [];
  let m;
  while ((m = skuRe.exec(s)) !== null) {
    hits.push({ sku: m[1].trim(), idx: m.index, full: m[0] });
  }

  for (let i = 0; i < hits.length; i++) {
    const { sku } = hits[i];
    const skuKey = normSkuKey(sku);
    const start = hits[i].idx;
    const end = hits[i + 1]?.idx ?? s.length;
    const block = s.slice(start, end);

    const nombre = extractNombreProducto(block);
    if (!nombre) continue;

    const rows = [];
    let seq = 0;
    const parts = block.split('\\par');
    for (const part of parts) {
      if (!part.includes('$')) continue;
      const priceM = part.match(/\$(\d+(?:\.\d+)?)/);
      if (!priceM) continue;
      const timeM = part.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/);
      const t = timeM ? parseMxDateTime(timeM[1]) : seq++;
      rows.push({
        t,
        price: parseFloat(priceM[1]),
      });
    }

    if (rows.length === 0) continue;

    const pricesConIva = pickFivePricesFromRows(rows, pad5);
    if (!pricesConIva) continue;

    const preciosConIva = mapFiveConIvaPricesToLists(pricesConIva);
    if (!preciosConIva) continue;

    map.set(skuKey, { nombre, preciosConIva });
  }

  return map;
}

export function conIvaASinIva(conIva, ivaPct) {
  const f = 1 + ivaPct / 100;
  return Math.round((conIva / f) * 100) / 100;
}

/** Índices por nombre para cuando el SKU del inventario no coincide con el RTF. */
export function buildPrecioIndexes(preciosMap) {
  const preciosByNombre = new Map();
  const preciosByNombreLoose = new Map();
  const nombreDup = [];
  const nombreLooseDup = [];
  for (const [, v] of preciosMap) {
    const nk = normNombreKey(v.nombre);
    if (nk) {
      if (preciosByNombre.has(nk)) nombreDup.push(nk);
      preciosByNombre.set(nk, v);
    }
    const nl = normNombreKeyLoose(v.nombre);
    if (nl) {
      if (preciosByNombreLoose.has(nl)) nombreLooseDup.push(nl);
      preciosByNombreLoose.set(nl, v);
    }
  }
  return { preciosByNombre, preciosByNombreLoose, nombreDup, nombreLooseDup };
}

export function matchRowToPrecios(preciosMap, preciosByNombre, preciosByNombreLoose, sku, nombre) {
  const skuKey = normSkuKey(sku);
  let p = preciosMap.get(skuKey);
  let how = 'sku';
  if (!p) {
    p = preciosByNombre.get(normNombreKey(nombre));
    how = 'nombre';
  }
  if (!p) {
    p = preciosByNombreLoose.get(normNombreKeyLoose(nombre));
    how = 'nombreLoose';
  }
  if (!p) return null;
  return { p, how };
}

/**
 * Objeto preciosConIva (claves LIST_KEYS) → precios sin IVA para guardar en doc.
 */
export function preciosConIvaToSinIvaRecord(preciosConIvaObj, ivaPct, sinIvaEnRtf) {
  const rec = {};
  for (const k of LIST_KEYS) {
    const con = preciosConIvaObj[k] ?? 0;
    rec[k] = sinIvaEnRtf ? Math.round(con * 100) / 100 : conIvaASinIva(con, ivaPct);
  }
  return rec;
}

export function loadRtfTextFromFile(rtfPath) {
  const rtfBuf = readFileSync(rtfPath);
  try {
    return rtfBuf.toString('latin1');
  } catch {
    return rtfBuf.toString('utf8');
  }
}
