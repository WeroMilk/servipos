#!/usr/bin/env node
/**
 * Importa inventario (.xlsx por carpeta) + lista de precios (.rtf) a Supabase
 * (tabla public.products para la sucursal indicada).
 *
 * Reglas de precios (igual que merge-olivares-precios-rtf.mjs):
 *   Hasta 5 capturas **más recientes por fecha** por artículo; se ordenan de mayor a menor →
 *   Regular, Técnico, Mayoreo −, Mayoreo +, Cananea. Listas sin dato no se guardan (no 0).
 *   Se guardan sin IVA en doc.preciosPorListaCliente y preciosListaIncluyenIva: false.
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL en .env) y SUPABASE_SERVICE_ROLE_KEY (service_role, NO anon).
 * Carga automática: `.env` y `.env.local` en la raíz del repo (igual que import CSV).
 *
 * Uso:
 *   npm run import:olivares-to-supabase -- --dir="..." --rtf="..." --sucursal=olivares --ultimo-gana
 *
 * Opciones:
 *   --dry-run
 *   --ultimo-gana          Mismo SKU en varios Excel: quedarse con el último archivo
 *   --incluir-ref-id
 *   --strict-precios       Falla si un producto no tiene match en el RTF
 *   --iva=16
 *   --sin-iva-en-rtf
 *   --pad-5                Repetir el último precio hasta completar 5 filas (compat. Crystal)
 *   --no-pad               Por defecto: solo las capturas reales (p. ej. 1 precio → solo Regular)
 *   --sucursal-nombre=...  Texto para crear fila en public.sucursales si no existe (default: id capitalizado)
 *   --batch=150
 *   --export-sin-rtf=./ruta.csv   CSV SKU,Nombre,Archivo para filas sin match en RTF
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildPrecioIndexes,
  matchRowToPrecios,
  preciosConIvaToSinIvaRecord,
  loadListaPreciosTextFromFile,
  parsePreciosListaAuto,
  LIST_KEYS,
} from './lib/olivaresRtfPrecios.mjs';
import { mergeRowsFromDir, disambiguateNombres, buildDescripcion } from './lib/olivaresInventoryFromDir.mjs';
import { unidadSatProductoOlivares } from './lib/olivaresUnidadSat.mjs';

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    const p = join(process.cwd(), name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) process.env[key] = val;
      }
    } catch {
      /* noop */
    }
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

loadEnvFiles();

function jwtPayloadRole(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function parseArgs() {
  const out = {
    dir: '',
    rtf: '',
    sucursal: 'olivares',
    sucursalNombre: '',
    dryRun: false,
    ultimoGana: false,
    incluirRefId: false,
    strictPrecios: false,
    ivaPct: 16,
    sinIvaEnRtf: false,
    pad5: false,
    batch: 150,
    /** Ruta CSV: SKUs sin match en RTF (SKU,Nombre,Archivo). */
    exportSinRtf: '',
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--ultimo-gana') out.ultimoGana = true;
    else if (a === '--incluir-ref-id') out.incluirRefId = true;
    else if (a === '--strict-precios') out.strictPrecios = true;
    else if (a === '--sin-iva-en-rtf') out.sinIvaEnRtf = true;
    else if (a === '--no-pad') out.pad5 = false;
    else if (a === '--pad-5') out.pad5 = true;
    else if (a.startsWith('--dir=')) out.dir = a.slice('--dir='.length).trim();
    else if (a.startsWith('--rtf=')) out.rtf = a.slice('--rtf='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--sucursal-nombre=')) out.sucursalNombre = a.slice('--sucursal-nombre='.length).trim();
    else if (a.startsWith('--iva=')) out.ivaPct = Number(a.slice('--iva='.length)) || 16;
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 150);
    else if (a.startsWith('--export-sin-rtf=')) out.exportSinRtf = a.slice('--export-sin-rtf='.length).trim();
  }
  return out;
}

/** Id estable por sucursal + SKU (hex 32) para upserts idempotentes. */
function productIdForSku(sucursalId, sku) {
  return createHash('sha256')
    .update(`${sucursalId}:${String(sku).trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function maxListaPrecio(recSinIva) {
  let best = 0;
  for (const k of LIST_KEYS) {
    const v = recSinIva[k];
    if (v != null && Number.isFinite(v) && v > best) best = v;
  }
  return best > 0 ? best : 0;
}

function buildProductDoc(r, recSinIva, incluirRefId, createdAtIso, updatedAtIso) {
  const unidadMedida = unidadSatProductoOlivares(r.nombre, r.categoria);
  const descripcion = buildDescripcion(r, incluirRefId);
  const lista = {};
  for (const k of LIST_KEYS) {
    const v = recSinIva[k];
    if (v != null && Number.isFinite(v)) lista[k] = v;
  }
  const precioVenta = recSinIva.regular ?? maxListaPrecio(recSinIva);
  return {
    sku: r.sku,
    codigoBarras: null,
    nombre: r.nombre,
    descripcion,
    precioVenta,
    precioCompra: null,
    impuesto: 16,
    existencia: r.existencia,
    existenciaMinima: 0,
    categoria: r.categoria,
    proveedor: null,
    preciosPorListaCliente: lista,
    preciosListaIncluyenIva: false,
    imagen: null,
    unidadMedida,
    claveProdServ: null,
    activo: true,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
  };
}

async function ensureSucursal(supabase, sucursalId, nombreDisplay) {
  const { data } = await supabase.from('sucursales').select('id').eq('id', sucursalId).maybeSingle();
  if (data) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('sucursales').insert({
    id: sucursalId,
    nombre: nombreDisplay || sucursalId,
    activo: true,
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`No se pudo crear sucursal: ${error.message}`);
}

/** Evita `.in('id', [...])` masivo: URL demasiado larga → `fetch failed` en Node. */
async function fetchExistingCreatedMap(supabase, sucursalId) {
  const map = new Map();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, doc')
      .eq('sucursal_id', sucursalId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const ca = row.doc && typeof row.doc.createdAt === 'string' ? row.doc.createdAt : null;
      if (ca) map.set(row.id, ca);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

async function flushProducts(supabase, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('products').upsert(chunk, { onConflict: 'sucursal_id,id' });
    if (error) throw new Error(error.message);
  }
}

async function main() {
  const args = parseArgs();
  if (!args.dir || !args.rtf) {
    console.error(
      'Uso: node scripts/import-olivares-to-supabase.mjs --dir="...xlsx" --rtf="...lista de precios.rtf" [--sucursal=olivares]'
    );
    process.exit(1);
  }
  if (!existsSync(args.dir)) {
    console.error('No existe la carpeta:', args.dir);
    process.exit(1);
  }
  if (!existsSync(args.rtf)) {
    console.error('No existe la lista de precios (RTF o PDF):', args.rtf);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!args.dryRun && (!url || !key)) {
    console.error(
      'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  En la raíz del proyecto, archivo .env.local (una línea, sin espacio tras =):\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n' +
        '  (Supabase → Settings → API → service_role; NO use la clave anon.)\n' +
        '  SUPABASE_URL se toma de .env o de VITE_SUPABASE_URL.'
    );
    process.exit(1);
  }
  if (!args.dryRun && key && jwtPayloadRole(key) !== 'service_role') {
    console.error(
      'La clave no es service_role. No use VITE_SUPABASE_ANON_KEY.\n' +
        'Use la clave "service_role" del panel de Supabase.'
    );
    process.exit(1);
  }

  const { bySku, duplicateSkus, perFile, allSkipped, files } = mergeRowsFromDir(args.dir, args.ultimoGana);

  if (duplicateSkus.length > 0 && !args.ultimoGana) {
    console.error('\nSKU duplicado(s) entre archivos (use --ultimo-gana):');
    for (const d of duplicateSkus.slice(0, 25)) {
      console.error(`  ${d.sku}: ${d.first} vs ${d.second}`);
    }
    process.exit(1);
  }

  const listaText = loadListaPreciosTextFromFile(args.rtf);
  const preciosMap = parsePreciosListaAuto(listaText, { pad5: args.pad5 });
  const idx = buildPrecioIndexes(preciosMap);

  if (idx.nombreDup.length) {
    console.error(`Aviso: ${idx.nombreDup.length} nombre(es) repetido(s) en RTF (última aparición gana).`);
  }
  if (idx.nombreLooseDup.length) {
    console.error(`Aviso: ${idx.nombreLooseDup.length} nombre(s) suelto(s) repetido(s) en RTF.`);
  }

  console.error(`Lista de precios: ${preciosMap.size} SKU(s) con precios parseados.`);
  console.error(`Carpeta: ${files.length} archivo(s) .xlsx.`);

  const rows = Array.from(bySku.values());
  disambiguateNombres(rows);

  const nowIso = new Date().toISOString();
  const toUpsert = [];
  let matched = 0;
  let matchedBySku = 0;
  let matchedByNombre = 0;
  let matchedByNombreLoose = 0;
  const missingPrecio = [];

  for (const r of rows) {
    const hit = matchRowToPrecios(preciosMap, idx.preciosByNombre, idx.preciosByNombreLoose, r.sku, r.nombre);
    if (!hit) {
      missingPrecio.push({ sku: r.sku, nombre: r.nombre, archivo: r.sourceFile });
      continue;
    }
    matched++;
    if (hit.how === 'sku') matchedBySku++;
    else if (hit.how === 'nombre') matchedByNombre++;
    else matchedByNombreLoose++;

    const recSinIva = preciosConIvaToSinIvaRecord(hit.p.preciosConIva, args.ivaPct, args.sinIvaEnRtf);
    const id = productIdForSku(args.sucursal, r.sku);
    const doc = buildProductDoc(r, recSinIva, args.incluirRefId, nowIso, nowIso);
    toUpsert.push({
      sucursal_id: args.sucursal,
      id,
      doc,
      updated_at: nowIso,
    });
  }

  console.error(
    `Filas con precio RTF: ${matched} (SKU ${matchedBySku}, nombre ${matchedByNombre}, nombre suelto ${matchedByNombreLoose})`
  );
  console.error(`Sin coincidencia en RTF: ${missingPrecio.length}`);
  console.error(`Productos a escribir: ${toUpsert.length}`);

  if (args.strictPrecios && missingPrecio.length > 0) {
    console.error('Primeros SKUs sin RTF:', missingPrecio.slice(0, 40).map((m) => m.sku).join(', '));
    throw new Error(`--strict-precios: ${missingPrecio.length} producto(s) sin lista de precios.`);
  }

  if (args.exportSinRtf && missingPrecio.length > 0) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ['SKU,Nombre,Archivo_xlsx', ...missingPrecio.map((m) => `${esc(m.sku)},${esc(m.nombre)},${esc(m.archivo)}`)];
    writeFileSync(args.exportSinRtf, lines.join('\n'), 'utf8');
    console.error(`Lista de sin RTF exportada: ${args.exportSinRtf} (${missingPrecio.length} filas).`);
  }

  if (args.dryRun) {
    console.error('\nDry-run: sin escritura en Supabase.');
    for (const r of toUpsert.slice(0, 12)) {
      const d = r.doc;
      console.error(
        `  ${d.sku} | ${d.nombre.slice(0, 50)}… | ex=${d.existencia} | pv=${d.precioVenta} | can=${d.preciosPorListaCliente?.cananea}`
      );
    }
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const existingCreated = await fetchExistingCreatedMap(supabase, args.sucursal);

  for (const row of toUpsert) {
    const prev = existingCreated.get(row.id);
    const created = prev ?? nowIso;
    row.doc.createdAt = created;
    row.doc.updatedAt = nowIso;
  }

  const nombreSuc =
    args.sucursalNombre ||
    args.sucursal.charAt(0).toUpperCase() + args.sucursal.slice(1).replace(/_/g, ' ');
  await ensureSucursal(supabase, args.sucursal, nombreSuc);

  await flushProducts(supabase, toUpsert, args.batch);

  console.error(`\nListo: ${toUpsert.length} producto(s) en public.products (sucursal_id=${args.sucursal}).`);
  if (missingPrecio.length) {
    console.error(
      `Advertencia: ${missingPrecio.length} SKU(s) sin match en RTF → no importados. Use --export-sin-rtf=./data/sin-precio-rtf.csv para listarlos.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  if (e && typeof e === 'object' && 'cause' in e && e.cause) {
    console.error('Cause:', e.cause);
  }
  process.exit(1);
});
