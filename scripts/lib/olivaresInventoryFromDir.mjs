/**
 * Lectura de inventario Olivares desde carpeta de .xlsx (una hoja por categoría).
 * Compartido con import-olivares-to-supabase.mjs
 */

import { readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import XLSX from 'xlsx';

/** Sin acentos, minúsculas, para comparar encabezados. */
function normHeader(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cellStr(v) {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

export function normSkuBarcode(s) {
  return cellStr(s).toLocaleUpperCase('es-MX').trim();
}

export function normalizeProductNombreKey(nombre) {
  return nombre.toLocaleUpperCase('es-MX').trim().replace(/\s+/g, ' ');
}

function parseNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function rowByNormHeaders(row) {
  const m = new Map();
  for (const [k, v] of Object.entries(row)) {
    m.set(normHeader(k), { key: k, value: v });
  }
  return m;
}

function pickByAliases(normMap, aliases) {
  for (const a of aliases) {
    const na = normHeader(a);
    if (normMap.has(na)) return normMap.get(na);
  }
  return null;
}

const INVENTORY_ALIASES = {
  id: ['id'],
  codigo: ['codigo', 'código', 'sku', 'clave'],
  descripcion: ['descripcion', 'descripción', 'nombre', 'producto'],
  cantidad: ['cantidad'],
  actual: ['actual', 'existencia', 'stock'],
  justificacion: ['justificacion', 'justificación', 'nota'],
};

function parseInventoryWorkbook(filePath, categoria) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const out = [];
  const skipped = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nm = rowByNormHeaders(row);
    const cod = pickByAliases(nm, INVENTORY_ALIASES.codigo);
    const desc = pickByAliases(nm, INVENTORY_ALIASES.descripcion);
    const act = pickByAliases(nm, INVENTORY_ALIASES.actual);
    const idCell = pickByAliases(nm, INVENTORY_ALIASES.id);
    const just = pickByAliases(nm, INVENTORY_ALIASES.justificacion);

    const skuRaw = cod ? cellStr(cod.value) : '';
    const nombreRaw = desc ? cellStr(desc.value) : '';
    const sku = normSkuBarcode(skuRaw);
    const nombre = normalizeProductNombreKey(nombreRaw);

    if (!sku || !nombre) {
      skipped.push({ file: basename(filePath), row: i + 2, reason: !sku ? 'sin codigo' : 'sin descripcion' });
      continue;
    }
    const headerLike = new Set(['CODIGO', 'CÓDIGO', 'ID', 'SKU', 'DESCRIPCION', 'DESCRIPCIÓN', 'CLAVE']);
    if (headerLike.has(sku) || (nombre.length < 40 && headerLike.has(nombre))) {
      skipped.push({ file: basename(filePath), row: i + 2, reason: 'fila encabezado o titulo' });
      continue;
    }

    const existencia = parseNumber(act?.value ?? 0);
    const idRef = idCell ? cellStr(idCell.value) : '';
    const justTxt = just ? cellStr(just.value) : '';

    out.push({
      sourceFile: basename(filePath),
      rowIndex: i + 2,
      categoria,
      sku,
      nombre,
      existencia,
      idRef,
      justTxt,
    });
  }
  return { rows: out, skipped };
}

function listInventoryXlsx(dir) {
  const names = readdirSync(dir)
    .filter((n) => extname(n).toLowerCase() === '.xlsx')
    .filter((n) => !n.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b, 'es'));
  return names.map((n) => join(dir, n));
}

export function mergeRowsFromDir(dir, ultimoGana) {
  const files = listInventoryXlsx(dir);
  if (files.length === 0) throw new Error(`No hay archivos .xlsx en: ${dir}`);

  const bySku = new Map();
  const duplicateSkus = [];
  const perFile = [];
  const allSkipped = [];

  for (const fp of files) {
    const cat = basename(fp, '.xlsx');
    const { rows, skipped } = parseInventoryWorkbook(fp, cat);
    allSkipped.push(...skipped);
    perFile.push({ file: basename(fp), count: rows.length, skipped: skipped.length });
    for (const r of rows) {
      if (!bySku.has(r.sku)) {
        bySku.set(r.sku, r);
      } else {
        duplicateSkus.push({ sku: r.sku, first: bySku.get(r.sku).sourceFile, second: r.sourceFile });
        if (ultimoGana) bySku.set(r.sku, r);
      }
    }
  }

  return { bySku, duplicateSkus, perFile, allSkipped, files };
}

export function disambiguateNombres(rows) {
  const byName = new Map();
  for (const r of rows) {
    const k = normalizeProductNombreKey(r.nombre);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  for (const [, list] of byName) {
    if (list.length <= 1) continue;
    for (const r of list) {
      r.nombre = `${r.nombre} (${r.sku})`;
    }
  }
}

export function buildDescripcion(r, incluirRefId) {
  const parts = [];
  if (incluirRefId && r.idRef) parts.push(`Ref: ${r.idRef}`);
  if (r.justTxt) parts.push(r.justTxt);
  if (parts.length === 0) return null;
  return parts.join(' | ');
}
