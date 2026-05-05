#!/usr/bin/env node
/**
 * Exporta CSV con todos los artículos parseados desde lista de precios.rtf (misma lógica que import).
 * Columnas: con IVA (como en Crystal) y sin IVA (como en BD con --iva=16).
 *
 * Uso:
 *   node scripts/export-rtf-precios-audit.mjs --rtf="C:\...\lista.pdf" --out="./data/audit-precios.csv"
 *
 * Opciones:
 *   --iva=16
 *   --no-pad   (omitir relleno a 5 precios; menos filas si faltan líneas en el RTF)
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIST_KEYS,
  parseListaPreciosBlocks,
  conIvaASinIva,
  loadListaPreciosTextFromFile,
  normNombreKey,
} from './lib/olivaresRtfPrecios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const out = { rtf: '', outPath: join(__dirname, '..', 'data', 'audit-precios-rtf.csv'), ivaPct: 16, pad5: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--rtf=')) out.rtf = a.slice(6).trim();
    else if (a.startsWith('--out=')) out.outPath = a.slice(6).trim();
    else if (a.startsWith('--iva=')) out.ivaPct = Number(a.slice(6)) || 16;
    else if (a === '--no-pad') out.pad5 = false;
  }
  return out;
}

function csvCell(s) {
  const t = String(s ?? '');
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function main() {
  const args = parseArgs();
  if (!args.rtf) {
    console.error('Uso: node scripts/export-rtf-precios-audit.mjs --rtf="...lista.rtf|.pdf" [--out=./data/audit.csv]');
    process.exit(1);
  }

  const listaText = loadListaPreciosTextFromFile(args.rtf);
  const blocks = parseListaPreciosBlocks(listaText, { pad5: args.pad5 });

  const header = [
    'sku',
    'nombre',
    ...LIST_KEYS.map((k) => `${k}_con_IVA`),
    ...LIST_KEYS.map((k) => `${k}_sin_IVA`),
    'nombre_normalizado',
  ];

  const skuCounts = new Map();
  const nombreCounts = new Map();
  const lines = [header.join(',')];

  for (const row of blocks) {
    skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + 1);
    const nk = normNombreKey(row.nombre);
    nombreCounts.set(nk, (nombreCounts.get(nk) ?? 0) + 1);

    const sin = {};
    for (const k of LIST_KEYS) {
      const c = row.preciosConIva[k];
      sin[k] =
        c != null && Number.isFinite(Number(c)) ? conIvaASinIva(Number(c), args.ivaPct) : '';
    }

    const cells = [
      row.sku,
      row.nombre,
      ...LIST_KEYS.map((k) =>
        row.preciosConIva[k] != null && Number.isFinite(Number(row.preciosConIva[k]))
          ? String(row.preciosConIva[k])
          : ''
      ),
      ...LIST_KEYS.map((k) => (sin[k] !== '' ? String(sin[k]) : '')),
      nk,
    ];
    lines.push(cells.map(csvCell).join(','));
  }

  writeFileSync(args.outPath, '\uFEFF' + lines.join('\r\n'), 'utf8');

  const dupSku = [...skuCounts.entries()].filter(([, n]) => n > 1);
  const dupNombre = [...nombreCounts.entries()].filter(([, n]) => n > 1);

  console.error(`Filas exportadas: ${blocks.length}`);
  console.error(`Salida: ${args.outPath}`);
  console.error(`SKU internos repetidos en el RTF (mismo código, varios productos): ${dupSku.length}`);
  if (dupSku.length && dupSku.length <= 30) {
    for (const [sku, n] of dupSku) console.error(`  ${sku}: ${n} bloques`);
  }
  console.error(`Nombres normalizados repetidos (último gana en índice por nombre): ${dupNombre.length}`);
}

main();
