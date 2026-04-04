#!/usr/bin/env node
/**
 * Lista SKUs del inventario exportado que NO aparecen en precios-merged (RTF).
 * Sirve para saber qué artículos faltan por cargar en otro Excel/CSV.
 *
 * Uso:
 *   node scripts/export-skus-faltantes-precios.mjs --inventario="...Inventario.csv" --precios=./data/precios-merged-olivares.csv --out=./data/skus-sin-precios-en-rtf.csv
 *
 * Con --plantilla: el CSV de salida usa las mismas columnas que --precios (precios vacíos) para rellenar en Excel.
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

function loadInventoryRows(csvPath) {
  const raw = readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const headerIdx = lines.findIndex((l) => l.includes('SKU') && l.includes('Nombre'));
  if (headerIdx < 0) throw new Error('Inventario: falta fila con SKU y Nombre');
  const header = parseCsvLine(lines[headerIdx]);
  const skuCol = header.findIndex((h) => h.trim() === 'SKU');
  const nombreCol = header.findIndex((h) => h.trim() === 'Nombre');
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const sku = normSku(cells[skuCol] ?? '');
    const nombre = (cells[nombreCol] ?? '').trim();
    if (sku) rows.push({ sku, nombre });
  }
  return rows;
}

function loadPreciosSkus(csvPath) {
  let raw = readFileSync(csvPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const iSku = header.findIndex((h) => h.trim() === 'SKU');
  if (iSku < 0) throw new Error('Precios: falta columna SKU');
  const set = new Set();
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    const sku = normSku(cells[iSku] ?? '');
    if (sku) set.add(sku);
  }
  return set;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  let inventario = '';
  let precios = '';
  let outPath = './data/skus-sin-precios-en-rtf.csv';
  let plantilla = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--inventario=')) inventario = a.slice('--inventario='.length).trim();
    else if (a.startsWith('--precios=')) precios = a.slice('--precios='.length).trim();
    else if (a.startsWith('--out=')) outPath = a.slice('--out='.length).trim();
    else if (a === '--plantilla') plantilla = true;
  }
  if (!inventario || !precios) {
    console.error(
      'Uso: node scripts/export-skus-faltantes-precios.mjs --inventario=Inventario.csv --precios=precios-merged-olivares.csv [--out=skus-faltantes.csv]'
    );
    process.exit(1);
  }
  if (!existsSync(inventario) || !existsSync(precios)) {
    console.error('Archivo no encontrado');
    process.exit(1);
  }

  const inv = loadInventoryRows(inventario);
  const conPrecio = loadPreciosSkus(precios);
  const faltantes = inv.filter((r) => !conPrecio.has(r.sku));

  let lines;
  if (plantilla) {
    let rawP = readFileSync(precios, 'utf8');
    if (rawP.charCodeAt(0) === 0xfeff) rawP = rawP.slice(1);
    const headerLine = rawP.split(/\r?\n/)[0];
    const headerCols = parseCsvLine(headerLine);
    lines = [headerLine];
    for (const r of faltantes) {
      const cells = headerCols.map((_, i) => {
        if (i === 0) return r.sku;
        if (i === 1) return r.nombre;
        return '';
      });
      lines.push(cells.map(csvEscape).join(','));
    }
  } else {
    lines = ['SKU,Nombre'];
    for (const r of faltantes) {
      lines.push(`${csvEscape(r.sku)},${csvEscape(r.nombre)}`);
    }
  }

  writeFileSync(outPath, '\uFEFF' + lines.join('\r\n'), 'utf8');
  console.log(`Artículos en inventario: ${inv.length}`);
  console.log(`Con precio en merged: ${conPrecio.size}`);
  console.log(`Sin precio en merged (faltantes): ${faltantes.length}`);
  console.log(`Salida: ${outPath}${plantilla ? ' (plantilla con columnas de precios)' : ''}`);
  console.log('');
  console.log(
    'Rellene precios en Excel, guarde UTF-8 CSV y ejecute: node scripts/combinar-precios-csv.mjs --a=precios-merged-olivares.csv --b=su-archivo.csv --out=precios-full.csv'
  );
}

main();
