#!/usr/bin/env node
/**
 * Actualiza precios en Firestore desde el CSV generado por merge-olivares-precios-rtf.mjs
 * (sucursales/{sucursal}/products), emparejando por campo `sku`.
 *
 * Requiere GOOGLE_APPLICATION_CREDENTIALS (salvo --dry-run).
 *
 * Uso:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\serviceAccount.json"
 *   node scripts/update-olivares-precios-from-csv.mjs --csv=./data/precios-merged-olivares.csv --sucursal=olivares --dry-run
 *   node scripts/update-olivares-precios-from-csv.mjs --csv=./data/precios-merged-olivares.csv --sucursal=olivares
 *
 * Opciones:
 *   --csv=            Ruta al CSV (UTF-8 con o sin BOM)
 *   --sucursal=       Id del documento de sucursal (default olivares)
 *   --project=        Project ID Firebase (default: .firebaserc)
 *   --dry-run         No escribe; muestra conteos y muestra
 *   --sample=12       En dry-run, cuántas filas de ejemplo
 *   --omitir-cero     No actualiza filas con precioVenta 0 (evita pisar con ceros)
 *
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readDefaultProjectId() {
  try {
    const rc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));
    const first = Object.values(rc.projects || {})[0];
    if (typeof first === 'string') return first;
  } catch {
    /* ignore */
  }
  return 'servipartzpos-26417';
}

function parseArgs() {
  const out = {
    csv: '',
    sucursal: 'olivares',
    project: process.env.FIREBASE_PROJECT_ID || readDefaultProjectId(),
    dryRun: false,
    sample: 12,
    omitirCero: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--omitir-cero') out.omitirCero = true;
    else if (a.startsWith('--csv=')) out.csv = a.slice('--csv='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length).trim();
    else if (a.startsWith('--sample=')) out.sample = Math.max(0, Number(a.slice('--sample='.length)) || 0);
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

function normSku(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es-MX');
}

function parseMergedCsv(csvPath, options = {}) {
  const omitirCero = options.omitirCero === true;
  let raw = readFileSync(csvPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error('CSV vacío o sin datos');
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const iSku = idx('SKU');
  const iPv = idx('precioVenta_sin_IVA');
  const iJson = idx('preciosPorListaCliente_json');
  const iReg = idx('lista_regular_sin_IVA');
  const iTec = idx('lista_tecnico_sin_IVA');
  const iCan = idx('lista_cananea_sin_IVA');
  const iMm = idx('lista_mayoreo_menos_sin_IVA');
  const iMp = idx('lista_mayoreo_mas_sin_IVA');

  if (iSku < 0 || iPv < 0) {
    throw new Error('El CSV debe incluir columnas SKU y precioVenta_sin_IVA');
  }

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (cells.length < header.length) continue;
    const sku = normSku(cells[iSku]);
    if (!sku) continue;
    const precioVenta = Number(String(cells[iPv] ?? '').replace(',', '.'));
    if (!Number.isFinite(precioVenta) || precioVenta < 0) continue;
    if (omitirCero && precioVenta === 0) continue;

    let preciosPorListaCliente;
    if (iJson >= 0 && cells[iJson]?.trim()) {
      try {
        preciosPorListaCliente = JSON.parse(cells[iJson].trim());
      } catch {
        preciosPorListaCliente = null;
      }
    }
    if (!preciosPorListaCliente && iReg >= 0 && iTec >= 0 && iCan >= 0 && iMm >= 0 && iMp >= 0) {
      preciosPorListaCliente = {
        regular: Number(String(cells[iReg] ?? '').replace(',', '.')),
        tecnico: Number(String(cells[iTec] ?? '').replace(',', '.')),
        cananea: Number(String(cells[iCan] ?? '').replace(',', '.')),
        mayoreo_menos: Number(String(cells[iMm] ?? '').replace(',', '.')),
        mayoreo_mas: Number(String(cells[iMp] ?? '').replace(',', '.')),
      };
    }
    if (!preciosPorListaCliente || typeof preciosPorListaCliente !== 'object') {
      console.warn(`Fila ${li + 1}: SKU ${sku} sin mapa de listas válido, se omite.`);
      continue;
    }

    rows.push({
      sku,
      precioVenta,
      preciosPorListaCliente,
    });
  }
  return rows;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getWithRetry(label, fn, maxAttempts = 8) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = e?.code;
      const msg = String(e?.message ?? e);
      const retryable =
        code === 8 ||
        code === 'RESOURCE_EXHAUSTED' ||
        msg.includes('Quota') ||
        msg.includes('RESOURCE_EXHAUSTED');
      if (!retryable || attempt === maxAttempts - 1) throw e;
      const waitMs = Math.min(120_000, 2000 * 2 ** attempt);
      console.warn(`${label}: error transitorio o cuota; reintento ${attempt + 2}/${maxAttempts} en ${waitMs}ms…`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs();
  if (!args.csv) {
    console.error('Falta --csv=ruta al archivo precios-merged-olivares.csv');
    process.exit(1);
  }
  if (!existsSync(args.csv)) {
    console.error('No existe el archivo:', args.csv);
    process.exit(1);
  }

  let rows;
  try {
    rows = parseMergedCsv(args.csv, { omitirCero: args.omitirCero });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log(`Proyecto: ${args.project}`);
  console.log(`Sucursal: ${args.sucursal}`);
  console.log(`Filas CSV válidas: ${rows.length}`);

  if (args.dryRun) {
    console.log('\n--- Muestra (primeras filas) ---');
    for (let i = 0; i < Math.min(args.sample, rows.length); i++) {
      const r = rows[i];
      console.log(
        `  ${r.sku} | precioVenta=${r.precioVenta} | listas=${JSON.stringify(r.preciosPorListaCliente)}`
      );
    }
    console.log('\nDry-run: no se leyó ni escribió Firestore.');
    return;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath?.trim()) {
    console.error('Falta GOOGLE_APPLICATION_CREDENTIALS (JSON de cuenta de servicio).');
    process.exit(1);
  }
  if (!existsSync(credPath)) {
    console.error('No existe el archivo de credenciales:', credPath);
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: args.project,
  });
  const db = admin.firestore();
  const col = db.collection('sucursales').doc(args.sucursal).collection('products');

  console.log('Leyendo productos de Firestore (toda la colección de la sucursal)…');
  let snap;
  try {
    snap = await getWithRetry('Lectura catálogo', () => col.get());
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes('Quota') || e?.code === 8) {
      console.error(
        '\nFirestore devolvió RESOURCE_EXHAUSTED (cuota agotada). Revise en Google Cloud Console:\n' +
          '  · Plan de facturación de Firebase / límites diarios del plan gratuito\n' +
          '  · Uso de Firestore: https://console.firebase.google.com/project/' +
          args.project +
          '/usage\n' +
          'Cuando haya cuota disponible, vuelva a ejecutar este script.\n'
      );
    }
    throw e;
  }
  const bySku = new Map();
  for (const doc of snap.docs) {
    const d = doc.data();
    const sku = normSku(d.sku);
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(doc.ref);
  }
  console.log(`Documentos en catálogo: ${snap.size} · SKUs distintos indexados: ${bySku.size}`);

  let updated = 0;
  let skippedNoDoc = 0;
  let skippedDup = 0;
  const ts = admin.firestore.FieldValue.serverTimestamp();

  let batch = db.batch();
  let ops = 0;

  async function commitBatch() {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const r of rows) {
    const refs = bySku.get(r.sku);
    if (!refs || refs.length === 0) {
      skippedNoDoc++;
      continue;
    }
    if (refs.length > 1) {
      console.warn(`SKU duplicado en Firestore (${refs.length} docs): ${r.sku} — se actualizan todos.`);
      skippedDup++;
    }

    const payload = {
      precioVenta: r.precioVenta,
      preciosPorListaCliente: r.preciosPorListaCliente,
      preciosListaIncluyenIva: false,
      updatedAt: ts,
    };

    for (const ref of refs) {
      batch.update(ref, payload);
      ops++;
      updated++;
      if (ops >= 500) {
        await commitBatch();
      }
    }
  }

  await commitBatch();

  console.log(`\nListo. Updates aplicados (refs de documento): ${updated}`);
  console.log(`SKUs en CSV sin coincidencia en Firestore: ${skippedNoDoc}`);
  if (skippedDup) console.log(`SKUs con más de un documento (avisos arriba): ${skippedDup}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
