#!/usr/bin/env node
/**
 * Une el inventario exportado (CSV SERVIPARTZ) con "lista de precios.rtf" (Crystal Reports).
 *
 * Del RTF se toman los 5 importes **con IVA** (pesos) y se asignan así:
 *   1) Cananea: el precio con IVA que **tiene centavos** (no termina en .00); si hay varios con
 *      centavos, el **menor** de ellos; si **ninguno** tiene centavos, cananea = el **menor** de los cinco.
 *   2) Regular, técnico, mayoreo −, mayoreo +: los **cuatro** restantes, de **mayor a menor**
 *      (mayor = regular, … menor = mayoreo +).
 *
 * Convierte precios **con IVA** a **sin IVA** para Firestore (igual que el catálogo).
 *
 * Emparejamiento con el inventario CSV (mismo orden de prioridad):
 *   1) SKU normalizado (MAYÚSCULAS, trim); el RTF usa códigos de hasta 14 dígitos.
 *   2) Nombre normalizado (mayúsculas, sin acentos, espacios colapsados).
 *   3) Nombre «suelto»: sin signos de puntuación (por si difiere el texto respecto a Crystal).
 *
 * Uso:
 *   node scripts/merge-olivares-precios-rtf.mjs --csv="..." --rtf="..." --out=./data/precios-merged.csv
 *
 * Opciones:
 *   --iva=16           Porcentaje IVA (default 16)
 *   --sin-iva-en-rtf   Si los valores del RTF ya vienen sin IVA (no dividir)
 *   --pad-5              Si hay 1–4 precios en el RTF, repite el último hasta completar 5 (usar con cuidado)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LIST_KEYS = ['regular', 'tecnico', 'cananea', 'mayoreo_menos', 'mayoreo_mas'];

/** Precio con IVA en pesos tiene centavos distintos de .00 */
function conIvaTieneCentavos(p) {
  const cents = Math.round(Number(p) * 100) % 100;
  return cents !== 0;
}

/**
 * Cinco precios con IVA → mapa para Firestore (mismas claves que la app).
 * Ver comentario del encabezado del archivo para las reglas de negocio.
 */
function mapFiveConIvaPricesToLists(pricesConIva) {
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

function normSkuKey(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es-MX');
}

/** Normaliza nombre para comparar inventario vs RTF (mayúsculas, espacios, sin acentos). */
function normNombreKey(s) {
  return String(s ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('es-MX')
    .replace(/\s+/g, ' ');
}

/** Más tolerante: quita puntuación (.,-/ etc.) que a veces difiere entre inventario y Crystal. */
function normNombreKeyLoose(s) {
  return normNombreKey(s)
    .replace(/Ñ/g, 'N')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs() {
  const out = {
    csv: '',
    rtf: '',
    outPath: join(__dirname, '..', 'data', 'precios-merged-olivares.csv'),
    ivaPct: 16,
    sinIvaEnRtf: false,
    pad5: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--csv=')) out.csv = a.slice('--csv='.length).trim();
    else if (a.startsWith('--rtf=')) out.rtf = a.slice('--rtf='.length).trim();
    else if (a.startsWith('--out=')) out.outPath = a.slice('--out='.length).trim();
    else if (a.startsWith('--iva=')) out.ivaPct = Number(a.slice('--iva='.length)) || 16;
    else if (a === '--sin-iva-en-rtf') out.sinIvaEnRtf = true;
    else if (a === '--pad-5') out.pad5 = true;
  }
  return out;
}

/** Quita bloques {\pict ... } del RTF (binario). */
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

/** Nombre del artículo (después de la línea "Código:", no el encabezado). */
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

/**
 * @param {{ pad5?: boolean }} opts
 * @returns {Map<string, { nombre: string, preciosConIva: Record<string, number> }>}
 */
function parsePreciosRtf(rtfText, opts = {}) {
  const pad5 = opts.pad5 === true;
  const s = stripRtfPictBlocks(rtfText);
  const map = new Map();

  /** Códigos de artículo / barras (hasta EAN-14); antes \d{1,8} truncaba SKUs largos. */
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

    const ordered = [...rows].sort((a, b) => a.t - b.t);
    let pricesConIva = ordered.map((r) => r.price).slice(0, 5);
    if (pricesConIva.length < 5 && pad5 && pricesConIva.length > 0) {
      const last = pricesConIva[pricesConIva.length - 1];
      while (pricesConIva.length < 5) pricesConIva.push(last);
    }
    if (pricesConIva.length < 5) continue;

    const preciosConIva = mapFiveConIvaPricesToLists(pricesConIva);
    if (!preciosConIva) continue;

    map.set(skuKey, { nombre, preciosConIva });
  }

  return map;
}

function conIvaASinIva(conIva, ivaPct) {
  const f = 1 + ivaPct / 100;
  return Math.round((conIva / f) * 100) / 100;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadInventoryCsv(csvPath) {
  const raw = readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 5) throw new Error('CSV demasiado corto');
  const headerIdx = lines.findIndex((l) => l.includes('SKU') && l.includes('Nombre'));
  if (headerIdx < 0) throw new Error('No se encontró fila de encabezados con SKU y Nombre');
  const header = parseCsvLine(lines[headerIdx]);
  const skuCol = header.findIndex((h) => h.trim() === 'SKU');
  const nombreCol = header.findIndex((h) => h.trim() === 'Nombre');
  if (skuCol < 0 || nombreCol < 0) throw new Error('Columnas SKU o Nombre no encontradas');

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < header.length - 2) continue;
    const sku = cells[skuCol]?.trim() ?? '';
    const nombre = cells[nombreCol]?.trim() ?? '';
    if (!sku) continue;
    rows.push({ sku, nombre, line: lines[i], cells, header });
  }
  return { header, headerIdx, lines, rows, skuCol, nombreCol };
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const args = parseArgs();
  if (!args.csv || !args.rtf) {
    console.error(
      'Uso: node scripts/merge-olivares-precios-rtf.mjs --csv="...Inventario.csv" --rtf="...lista de precios.rtf" [--out=./data/precios-merged.csv]'
    );
    process.exit(1);
  }
  if (!existsSync(args.csv)) {
    console.error('No existe el CSV:', args.csv);
    process.exit(1);
  }
  if (!existsSync(args.rtf)) {
    console.error('No existe el RTF:', args.rtf);
    process.exit(1);
  }

  const rtfBuf = readFileSync(args.rtf);
  let rtfText;
  try {
    rtfText = rtfBuf.toString('latin1');
  } catch {
    rtfText = rtfBuf.toString('utf8');
  }

  const preciosMap = parsePreciosRtf(rtfText, { pad5: args.pad5 });
  console.error(`Productos con precios en RTF (por SKU): ${preciosMap.size}${args.pad5 ? ' (--pad-5 activo)' : ''}`);

  /** Índice por nombre (estricto y suelto) cuando el SKU del inventario no coincide con el RTF. */
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
  if (nombreDup.length) {
    console.error(
      `Aviso: ${nombreDup.length} nombre(es) estricto(s) repetido(s) en RTF; se usa la última aparición.`
    );
  }
  if (nombreLooseDup.length) {
    console.error(
      `Aviso: ${nombreLooseDup.length} nombre(es) «suelto(s)» repetido(s) en RTF; se usa la última aparición.`
    );
  }

  const inv = loadInventoryCsv(args.csv);
  const outCols = [
    'SKU',
    'Nombre',
    'precioVenta_sin_IVA',
    ...LIST_KEYS.map((k) => `lista_${k}_sin_IVA`),
    'preciosPorListaCliente_json',
  ];

  const linesOut = [outCols.join(',')];
  let matched = 0;
  let matchedBySku = 0;
  let matchedByNombre = 0;
  let matchedByNombreLoose = 0;
  let missing = 0;

  for (const row of inv.rows) {
    const skuKey = normSkuKey(row.sku);
    let p = preciosMap.get(skuKey);
    let how = 'sku';
    if (!p) {
      p = preciosByNombre.get(normNombreKey(row.nombre));
      how = 'nombre';
    }
    if (!p) {
      p = preciosByNombreLoose.get(normNombreKeyLoose(row.nombre));
      how = 'nombreLoose';
    }
    if (!p) {
      missing++;
      continue;
    }
    matched++;
    if (how === 'sku') matchedBySku++;
    else if (how === 'nombre') matchedByNombre++;
    else matchedByNombreLoose++;
    const rec = {};
    const cols = [];
    for (const k of LIST_KEYS) {
      const con = p.preciosConIva[k] ?? 0;
      const sin = args.sinIvaEnRtf ? Math.round(con * 100) / 100 : conIvaASinIva(con, args.ivaPct);
      rec[k] = sin;
    }
    const precioVenta = rec.regular ?? 0;

    cols.push(
      csvEscape(skuKey),
      csvEscape(row.nombre),
      String(precioVenta),
      ...LIST_KEYS.map((k) => String(rec[k] ?? 0)),
      csvEscape(JSON.stringify(rec))
    );
    linesOut.push(cols.join(','));
  }

  writeFileSync(args.outPath, '\uFEFF' + linesOut.join('\r\n'), 'utf8');
  console.error(
    `Filas escritas con precio del RTF: ${matched} (SKU: ${matchedBySku}, nombre: ${matchedByNombre}, nombre suelto: ${matchedByNombreLoose})`
  );
  console.error(`Filas del inventario sin coincidencia en RTF (ni SKU ni nombre): ${missing}`);
  console.error(`Salida: ${args.outPath}`);
  console.error('');
  console.error(
    'Revise 2–3 productos: cananea = precio con centavos (o el menor si todos son .00); las otras cuatro listas van de mayor a menor.'
  );
}

main();
