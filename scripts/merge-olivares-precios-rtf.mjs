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
 * Convierte precios **con IVA** a **sin IVA** para el catálogo.
 *
 * Uso:
 *   node scripts/merge-olivares-precios-rtf.mjs --csv="..." --rtf="..." --out=./data/precios-merged.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePreciosRtf,
  conIvaASinIva,
  normSkuKey,
  normNombreKey,
  normNombreKeyLoose,
  LIST_KEYS,
  buildPrecioIndexes,
  loadRtfTextFromFile,
} from './lib/olivaresRtfPrecios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  const rtfText = loadRtfTextFromFile(args.rtf);
  const preciosMap = parsePreciosRtf(rtfText, { pad5: args.pad5 });
  console.error(`Productos con precios en RTF (por SKU): ${preciosMap.size}${args.pad5 ? ' (--pad-5 activo)' : ''}`);

  const idx = buildPrecioIndexes(preciosMap);
  if (idx.nombreDup.length) {
    console.error(
      `Aviso: ${idx.nombreDup.length} nombre(es) estricto(s) repetido(s) en RTF; se usa la última aparición.`
    );
  }
  if (idx.nombreLooseDup.length) {
    console.error(
      `Aviso: ${idx.nombreLooseDup.length} nombre(es) «suelto(s)» repetido(s) en RTF; se usa la última aparición.`
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
      p = idx.preciosByNombre.get(normNombreKey(row.nombre));
      how = 'nombre';
    }
    if (!p) {
      p = idx.preciosByNombreLoose.get(normNombreKeyLoose(row.nombre));
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
