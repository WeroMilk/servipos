/**
 * Lista de precios Crystal: RTF o texto extraído de PDF + asignación a listas (regular…Cananea).
 * Usado por merge-olivares-precios-rtf.mjs e import-olivares-to-supabase.mjs.
 *
 * Reglas:
 * - Se toman hasta **5 líneas de precio más recientes** por marca de tiempo (global al bloque del artículo),
 *   no solo las del último día calendario (evita quedarse sin el precio más alto del mismo día).
 * - Esos importes (con IVA) se ordenan de **mayor a menor** y se asignan:
 *   Regular → Técnico → Mayoreo − → Mayoreo + → Cananea.
 * - Si hay menos de 5 capturas: solo se llenan las primeras listas; el resto **omite** (no se rellena con 0 en
 *   `preciosConIvaToSinIvaRecord`). Con `--pad-5` / `pad5: true` se repite el último precio hasta 5 filas.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const LIST_KEYS = ['regular', 'tecnico', 'cananea', 'mayoreo_menos', 'mayoreo_mas'];

/** Orden de asignación tras ordenar precios de mayor a menor (Cananea = el más barato del conjunto). */
const TIER_BY_RANK = ['regular', 'tecnico', 'mayoreo_menos', 'mayoreo_mas', 'cananea'];

const PRICE_AFTER_DOLLAR_RE = /^\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/;

function parseMoneyToken(str) {
  const m = String(str ?? '').match(PRICE_AFTER_DOLLAR_RE);
  if (!m) return NaN;
  return parseFloat(m[1].replace(/,/g, ''));
}

/**
 * Hasta 5 importes con IVA (los más recientes por fecha) → mapa parcial por lista.
 * @param {number[]} pricesConIva — típicamente length 1–5
 * @returns {Record<string, number> | null}
 */
export function mapRecentConIvaPricesToLists(pricesConIva) {
  const arr = pricesConIva
    .slice(0, 5)
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p >= 0);
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => b - a);
  /** @type {Record<string, number>} */
  const out = {};
  for (let i = 0; i < sorted.length && i < TIER_BY_RANK.length; i++) {
    out[TIER_BY_RANK[i]] = sorted[i];
  }
  return out;
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

/**
 * Fecha/hora lista Crystal (México): DD/MM/AAAA y 12 h con `a. m.` / `p. m.`
 */
function parseMxDateTime(str) {
  const trimmed = String(str ?? '').replace(/\s+/g, ' ').trim();
  const withAmPm = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([ap])\.\s*m\.$/i
  );
  if (withAmPm) {
    const [, day, month, y, hh, mm, ss, ap] = withAmPm;
    let hour = Number(hh);
    const isPm = ap.toLowerCase() === 'p';
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return new Date(Number(y), Number(month) - 1, Number(day), hour, Number(mm), Number(ss)).getTime();
  }
  const noAmPm = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!noAmPm) return 0;
  const [, day, month, y, hh, mm, ss] = noAmPm;
  return new Date(Number(y), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss)).getTime();
}

/** `t` es marca de tiempo real (ms), no índice secuencial del RTF. */
function isRealTimestampMs(t) {
  return typeof t === 'number' && t > 946684800000;
}

/**
 * De todas las filas de precio del bloque: hasta 5 más recientes por fecha; luego líneas sin fecha
 * por orden de aparición. Opcionalmente replica el último hasta 5 (`pad5`).
 * @returns {number[]}
 */
function pickRecentPriceRows(rows, pad5) {
  if (rows.length === 0) return [];

  const withOrd = rows.map((r, i) => ({ price: r.price, t: r.t, ord: r.ord ?? i }));
  const realRows = withOrd.filter((r) => isRealTimestampMs(r.t));
  /** @type {typeof withOrd} */
  let orderedPick = [];

  if (realRows.length > 0) {
    realRows.sort((a, b) => b.t - a.t);
    orderedPick = realRows.slice(0, 5);
    if (orderedPick.length < 5) {
      const fakeRows = withOrd.filter((r) => !isRealTimestampMs(r.t));
      fakeRows.sort((a, b) => b.ord - a.ord);
      for (const r of fakeRows) {
        if (orderedPick.length >= 5) break;
        orderedPick.push(r);
      }
    }
  } else {
    const copy = [...withOrd];
    copy.sort((a, b) => b.ord - a.ord);
    orderedPick = copy.slice(0, 5);
  }

  let chosen = orderedPick.map((r) => r.price);

  if (chosen.length < 5 && pad5 && chosen.length > 0) {
    const last = chosen[chosen.length - 1];
    while (chosen.length < 5) chosen.push(last);
  }

  return chosen;
}

/**
 * @param {string} block
 * @param {boolean} pad5
 */
function parseBlockToPreciosConIva(block, pad5) {
  const nombre = extractNombreProducto(block);
  if (!nombre) return null;

  const rows = [];
  let ord = 0;
  const parts = block.split('\\par');
  for (const part of parts) {
    if (!part.includes('$')) continue;
    const priceM = part.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1].replace(/,/g, ''));
    if (!Number.isFinite(price)) continue;
    const timeM = part.match(
      /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}(?:\s*[ap]\.\s*m\.)?)/i
    );
    const o = ord++;
    const t = timeM ? parseMxDateTime(timeM[1]) : o;
    rows.push({ t, price, ord: o });
  }

  if (rows.length === 0) return null;

  const pricesConIva = pickRecentPriceRows(rows, pad5);
  if (pricesConIva.length === 0) return null;

  const preciosConIva = mapRecentConIvaPricesToLists(pricesConIva);
  if (!preciosConIva) return null;

  return { nombre, preciosConIva };
}

const RTF_SKU_LINE_RE = /[\\]cf1\s+([A-Za-z0-9]{1,24})\s*\\par/g;

function isLikelyRtfSkuToken(token) {
  const t = String(token ?? '').trim();
  return t.length > 0 && /\d/.test(t);
}

/**
 * Todos los artículos en orden (RTF o texto plano/PDF). Misma forma que `parsePreciosRtfBlocks`.
 */
export function parseListaPreciosBlocks(text, opts = {}) {
  if (isProbablyRtf(text)) return parsePreciosRtfBlocks(text, opts);
  const pad5 = opts.pad5 === true;
  const blocks = splitPlainTextProductBlocks(text);
  const out = [];
  for (const b of blocks) {
    if (!b.nombre) continue;
    const preciosConIva = parsePlainBodyToPrecios(b.body, pad5);
    if (!preciosConIva) continue;
    out.push({ sku: b.skuKey, nombre: b.nombre, preciosConIva });
  }
  return out;
}

export function parsePreciosRtfBlocks(rtfText, opts = {}) {
  const pad5 = opts.pad5 === true;
  const s = stripRtfPictBlocks(rtfText);
  const skuRe = new RegExp(RTF_SKU_LINE_RE.source, 'g');
  const hits = [];
  let m;
  while ((m = skuRe.exec(s)) !== null) {
    const sku = m[1].trim();
    if (!isLikelyRtfSkuToken(sku)) continue;
    hits.push({ sku, idx: m.index, full: m[0] });
  }

  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const skuKey = normSkuKey(hits[i].sku);
    const start = hits[i].idx;
    const end = hits[i + 1]?.idx ?? s.length;
    const block = s.slice(start, end);
    const parsed = parseBlockToPreciosConIva(block, pad5);
    if (!parsed) continue;
    out.push({ sku: skuKey, nombre: parsed.nombre, preciosConIva: parsed.preciosConIva });
  }
  return out;
}

/**
 * @returns {Map<string, { nombre: string, preciosConIva: Record<string, number> } | Array>}
 */
export function parsePreciosRtf(rtfText, opts = {}) {
  const pad5 = opts.pad5 === true;
  const s = stripRtfPictBlocks(rtfText);
  const map = new Map();

  const skuRe = new RegExp(RTF_SKU_LINE_RE.source, 'g');
  const hits = [];
  let m;
  while ((m = skuRe.exec(s)) !== null) {
    const sku = m[1].trim();
    if (!isLikelyRtfSkuToken(sku)) continue;
    hits.push({ sku, idx: m.index, full: m[0] });
  }

  for (let i = 0; i < hits.length; i++) {
    const { sku } = hits[i];
    const skuKey = normSkuKey(sku);
    const start = hits[i].idx;
    const end = hits[i + 1]?.idx ?? s.length;
    const block = s.slice(start, end);

    const parsed = parseBlockToPreciosConIva(block, pad5);
    if (!parsed) continue;

    const entry = { nombre: parsed.nombre, preciosConIva: parsed.preciosConIva };
    const prev = map.get(skuKey);
    if (prev === undefined) {
      map.set(skuKey, entry);
    } else if (Array.isArray(prev)) {
      prev.push(entry);
    } else {
      map.set(skuKey, [prev, entry]);
    }
  }

  return map;
}

function isProbablyRtf(s) {
  return /\\cf1\s+[A-Za-z0-9]/i.test(s) && /\\par/i.test(s);
}

/** Texto extraído de PDF a veces rompe la ó: `Cdigo`, `Cdigo`, etc. */
const PLAIN_CODIGO_MARKER_RE =
  /(?:c.digo:\s*([A-Za-z0-9]{1,24})(?=[\s\n\r]|$)|([A-Za-z0-9]{1,24})c.digo:)/gi;

function lineSliceAtIndex(normalized, idx) {
  const lineStart = normalized.lastIndexOf('\n', Math.max(0, idx - 1)) + 1;
  let lineEnd = normalized.indexOf('\n', idx);
  if (lineEnd === -1) lineEnd = normalized.length;
  return normalized.slice(lineStart, lineEnd);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Crystal PDF suele poner `2070Código:` (SKU pegado antes de la palabra). */
function extractNombreFromPdfHeaderLine(line, skuRaw) {
  const skuE = escapeRegExp(String(skuRaw).trim());
  if (!skuE) return '';
  let t = line.replace(new RegExp(`\\s*${skuE}\\s*c.digo:.*$`, 'iu'), '').trim();
  if (t.length > 2) return t;
  t = line.replace(/^c.digo:\s*\S+\s*$/iu, '').trim();
  return t.length > 2 ? t : '';
}

function extractNombreFromPlainBeforeChunk(chunk) {
  const lines = chunk
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (/^c.digo:/iu.test(ln)) continue;
    if (/\$\s*\d/.test(ln)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(ln)) continue;
    if (ln.length < 2) continue;
    return ln;
  }
  return '';
}

function extractNombreFromPlainBody(body) {
  const lines = body.split('\n').map((l) => l.trim());
  let i = 0;
  if (lines[0] && /^c.digo:/iu.test(lines[0])) i = 1;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    if (/\$\s*\d/.test(ln) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(ln)) break;
    if (/\$\s*\d/.test(ln)) break;
    if (ln.length > 3 && !/^c.digo:/iu.test(ln)) return ln;
  }
  return '';
}

/** @returns {{ skuKey: string, nombre: string, body: string }[]} */
function splitPlainTextProductBlocks(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const hits = [];
  let m;
  const re = new RegExp(PLAIN_CODIGO_MARKER_RE.source, 'gi');
  while ((m = re.exec(normalized)) !== null) {
    const skuRaw = (m[1] || m[2] || '').trim();
    if (!isLikelyRtfSkuToken(skuRaw)) continue;
    hits.push({ skuRaw, idx: m.index, len: m[0].length });
  }

  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const prev = hits[i - 1];
    const cur = hits[i];
    const prevIdx = prev ? prev.idx + prev.len : 0;
    const chunkBefore = normalized.slice(prevIdx, cur.idx);

    const headerLine = lineSliceAtIndex(normalized, cur.idx);
    let nombre = extractNombreFromPdfHeaderLine(headerLine, cur.skuRaw);
    if (!nombre) nombre = extractNombreFromPlainBeforeChunk(chunkBefore);
    const next = hits[i + 1];
    const bodyEnd = next ? next.idx : normalized.length;
    const body = normalized.slice(cur.idx, bodyEnd);
    if (!nombre) nombre = extractNombreFromPlainBody(body);
    out.push({ skuKey: normSkuKey(cur.skuRaw), nombre, body });
  }
  return out;
}

function parsePlainBodyToPrecios(body, pad5) {
  const rows = [];
  const lines = body.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    const d = line.indexOf('$');
    if (d < 0) continue;
    const price = parseMoneyToken(line.slice(d));
    if (!Number.isFinite(price)) continue;
    const timeM = line.match(
      /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}(?:\s*[ap]\.\s*m\.)?)/i
    );
    const t = timeM ? parseMxDateTime(timeM[1]) : li;
    rows.push({ t, price, ord: li });
  }
  if (rows.length === 0) return null;
  const pricesConIva = pickRecentPriceRows(rows, pad5);
  if (pricesConIva.length === 0) return null;
  return mapRecentConIvaPricesToLists(pricesConIva);
}

/**
 * Texto plano (p. ej. extraído de PDF) con líneas `Código: ...` y precios `$...`
 * @returns {Map<string, { nombre: string, preciosConIva: Record<string, number> } | Array>}
 */
export function parsePreciosPlainText(text, opts = {}) {
  const pad5 = opts.pad5 === true;
  const blocks = splitPlainTextProductBlocks(text);
  const map = new Map();

  for (const b of blocks) {
    if (!b.nombre) continue;
    const preciosConIva = parsePlainBodyToPrecios(b.body, pad5);
    if (!preciosConIva) continue;
    const entry = { nombre: b.nombre, preciosConIva };
    const prev = map.get(b.skuKey);
    if (prev === undefined) {
      map.set(b.skuKey, entry);
    } else if (Array.isArray(prev)) {
      prev.push(entry);
    } else {
      map.set(b.skuKey, [prev, entry]);
    }
  }
  return map;
}

export function parsePreciosListaAuto(text, opts = {}) {
  if (isProbablyRtf(text)) return parsePreciosRtf(text, opts);
  return parsePreciosPlainText(text, opts);
}

function extractPdfTextToString(pdfPath) {
  const script = join(__dirname, '..', 'python', 'extract_pdf_text.py');
  const attempts = [
    ['py', '-3', script, pdfPath],
    ['python', script, pdfPath],
    ['python3', script, pdfPath],
  ];
  let lastErr;
  for (const args of attempts) {
    try {
      return execFileSync(args[0], args.slice(1), {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 80,
        windowsHide: true,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `No se pudo extraer texto del PDF. Instale Python y pypdf (pip install pypdf). Detalle: ${lastErr?.message ?? lastErr}`
  );
}

/** RTF / PDF (extrae texto con Python) → string para parsear. */
export function loadListaPreciosTextFromFile(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.pdf')) {
    return extractPdfTextToString(filePath);
  }
  return loadRtfTextFromFile(filePath);
}

export function loadAndParseListaPrecios(filePath, opts = {}) {
  return parsePreciosListaAuto(loadListaPreciosTextFromFile(filePath), opts);
}

export function conIvaASinIva(conIva, ivaPct) {
  const f = 1 + ivaPct / 100;
  return Math.round((conIva / f) * 100) / 100;
}

function flattenPrecioMapValues(preciosMap) {
  const out = [];
  for (const [, v] of preciosMap) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

export function buildPrecioIndexes(preciosMap) {
  const preciosByNombre = new Map();
  const preciosByNombreLoose = new Map();
  const nombreDup = [];
  const nombreLooseDup = [];
  for (const v of flattenPrecioMapValues(preciosMap)) {
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
  const want = normNombreKey(nombre);
  const wantLoose = normNombreKeyLoose(nombre);
  const raw = preciosMap.get(skuKey);
  if (raw) {
    if (Array.isArray(raw)) {
      const byNombre = raw.find((e) => normNombreKey(e.nombre) === want);
      if (byNombre) return { p: byNombre, how: 'sku' };
      const byLoose = raw.find((e) => normNombreKeyLoose(e.nombre) === wantLoose);
      if (byLoose) return { p: byLoose, how: 'sku' };
      return { p: raw[raw.length - 1], how: 'sku' };
    }
    return { p: raw, how: 'sku' };
  }
  let p = preciosByNombre.get(want);
  if (p) return { p, how: 'nombre' };
  p = preciosByNombreLoose.get(wantLoose);
  if (p) return { p, how: 'nombreLoose' };
  return null;
}

/**
 * Solo convierte claves presentes (listas vacías no se guardan como 0).
 */
export function preciosConIvaToSinIvaRecord(preciosConIvaObj, ivaPct, sinIvaEnRtf) {
  const rec = {};
  for (const k of LIST_KEYS) {
    const con = preciosConIvaObj[k];
    if (con == null || !Number.isFinite(Number(con)) || Number(con) < 0) continue;
    rec[k] = sinIvaEnRtf ? Math.round(Number(con) * 100) / 100 : conIvaASinIva(Number(con), ivaPct);
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
