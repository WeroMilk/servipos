#!/usr/bin/env node
/**
 * Une dos CSV con el mismo formato que precios-merged-olivares.csv (salida del merge RTF).
 * El segundo archivo pisa al primero si el SKU coincide (útil: precios RTF + Excel con faltantes).
 *
 * Uso:
 *   node scripts/combinar-precios-csv.mjs --a=./data/precios-merged-olivares.csv --b=./data/precios-extra.xlsx.csv --out=./data/precios-full.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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

function normSku(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es-MX');
}

function loadPreciosCsv(path) {
  let raw = readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error('CSV vacío');
  const header = parseCsvLine(lines[0]);
  const iSku = header.findIndex((h) => h.trim() === 'SKU');
  if (iSku < 0) throw new Error('Falta columna SKU');
  const map = new Map();
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (cells.length < 2) continue;
    const sku = normSku(cells[iSku]);
    if (!sku) continue;
    map.set(sku, { line: lines[li], cells });
  }
  return { headerLine: lines[0], map };
}

function main() {
  let pathA = '';
  let pathB = '';
  let outPath = './data/precios-full-olivares.csv';
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--a=')) pathA = a.slice('--a='.length).trim();
    else if (a.startsWith('--b=')) pathB = a.slice('--b='.length).trim();
    else if (a.startsWith('--out=')) outPath = a.slice('--out='.length).trim();
  }
  if (!pathA || !pathB) {
    console.error('Uso: node scripts/combinar-precios-csv.mjs --a=primer.csv --b=segundo.csv [--out=precios-full.csv]');
    console.error('  El archivo --b pisa a --a por mismo SKU.');
    process.exit(1);
  }
  if (!existsSync(pathA) || !existsSync(pathB)) {
    console.error('No existe --a o --b');
    process.exit(1);
  }

  const A = loadPreciosCsv(pathA);
  const B = loadPreciosCsv(pathB);
  const merged = new Map(A.map);
  for (const [sku, row] of B.map) {
    merged.set(sku, row);
  }

  const linesOut = [A.headerLine];
  const skus = [...merged.keys()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  for (const sku of skus) {
    linesOut.push(merged.get(sku).line);
  }

  writeFileSync(outPath, '\uFEFF' + linesOut.join('\r\n'), 'utf8');
  console.log(`Combinado: ${A.map.size} (a) + ${B.map.size} (b) → ${merged.size} filas únicas por SKU`);
  console.log(`Salida: ${outPath}`);
}

main();
