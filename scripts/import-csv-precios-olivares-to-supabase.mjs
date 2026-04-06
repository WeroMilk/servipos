#!/usr/bin/env node
/**
 * Importa productos a public.products desde precios-merged-olivares.csv (SKU, Nombre, precios sin IVA, JSON listas).
 * No requiere carpetas .xlsx ni RTF (usa el CSV ya mergeado en /data).
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL en .env) y SUPABASE_SERVICE_ROLE_KEY (rol service_role, NO anon).
 *
 * Carga automática: lee `.env` y `.env.local` desde la raíz del repo (sin dependencia dotenv).
 * Añada `SUPABASE_SERVICE_ROLE_KEY=...` en `.env.local` (gitignored). Dashboard → Settings → API → service_role.
 *
 * Uso:
 *   npm run import:csv-olivares-to-supabase -- --csv=./data/precios-merged-olivares.csv --sucursal=olivares
 *
 * Opciones: --dry-run, --batch=150
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

/** Lee .env luego .env.local (la segunda pisa la primera). Sin espacios alrededor de `=`. */
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

const LIST_KEYS = ['regular', 'tecnico', 'cananea', 'mayoreo_menos', 'mayoreo_mas'];

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

function parseArgs() {
  const out = { csv: './data/precios-merged-olivares.csv', sucursal: 'olivares', dryRun: false, batch: 150 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a.startsWith('--csv=')) out.csv = a.slice('--csv='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 150);
  }
  return out;
}

function productIdForSku(sucursalId, sku) {
  return createHash('sha256')
    .update(`${sucursalId}:${String(sku).trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function normSku(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es-MX');
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

/**
 * Evita `.in('id', [...500])`: la URL GET supera límites y Node devuelve `TypeError: fetch failed`.
 */
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

function numCell(c) {
  const n = Number(String(c ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Columnas numéricas del merge (más fiable que JSON con comillas CSV). */
function buildListaFromRow(cells, header) {
  const idx = (name) => header.indexOf(name);
  const ir = idx('lista_regular_sin_IVA');
  const it = idx('lista_tecnico_sin_IVA');
  const ic = idx('lista_cananea_sin_IVA');
  const imm = idx('lista_mayoreo_menos_sin_IVA');
  const imp = idx('lista_mayoreo_mas_sin_IVA');
  if (ir < 0 || it < 0 || ic < 0 || imm < 0 || imp < 0) return null;
  return {
    regular: numCell(cells[ir]),
    tecnico: numCell(cells[it]),
    cananea: numCell(cells[ic]),
    mayoreo_menos: numCell(cells[imm]),
    mayoreo_mas: numCell(cells[imp]),
  };
}

function parseListaJson(cell) {
  let t = String(cell ?? '').trim();
  if (!t) return null;
  t = t.replace(/""/g, '"');
  try {
    const o = JSON.parse(t);
    const lista = {};
    for (const k of LIST_KEYS) {
      const v = o[k];
      lista[k] = typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
    }
    return lista;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs();
  if (!existsSync(args.csv)) {
    console.error('No existe el CSV:', args.csv);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!args.dryRun && (!url || !key)) {
    console.error(
      'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  Añada en .env.local (una línea, sin espacio tras =):\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n' +
        '  (Supabase → Project Settings → API → service_role secret; NO use la clave anon.)\n' +
        '  SUPABASE_URL se toma de .env o de VITE_SUPABASE_URL.'
    );
    process.exit(1);
  }
  if (!args.dryRun && key && jwtPayloadRole(key) !== 'service_role') {
    console.error(
      'La clave no es service_role (JWT role !== service_role). No use VITE_SUPABASE_ANON_KEY.\n' +
        'Use la clave "service_role" del panel de Supabase.'
    );
    process.exit(1);
  }

  let raw = readFileSync(args.csv, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error('CSV vacío');

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iSku = idx('SKU');
  const iNombre = idx('Nombre');
  const iPv = idx('precioVenta_sin_IVA');
  const iJson = idx('preciosPorListaCliente_json');
  const iExistencia = idx('Existencia');
  const iCategoria = idx('Categoria');
  if (iSku < 0 || iNombre < 0 || iPv < 0) {
    throw new Error('CSV debe incluir columnas: SKU, Nombre, precioVenta_sin_IVA');
  }

  const nowIso = new Date().toISOString();
  const bySku = new Map();

  const listaCols = [
    'lista_regular_sin_IVA',
    'lista_tecnico_sin_IVA',
    'lista_cananea_sin_IVA',
    'lista_mayoreo_menos_sin_IVA',
    'lista_mayoreo_mas_sin_IVA',
  ].map((n) => header.indexOf(n));
  const widthCandidates = [iSku, iNombre, iPv, ...listaCols.filter((i) => i >= 0)];
  if (iJson >= 0) widthCandidates.push(iJson);
  if (iExistencia >= 0) widthCandidates.push(iExistencia);
  if (iCategoria >= 0) widthCandidates.push(iCategoria);
  const minCells = Math.max(...widthCandidates) + 1;

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (cells.length < minCells) continue;
    const sku = normSku(cells[iSku]);
    if (!sku) continue;
    const nombre = String(cells[iNombre] ?? '').trim();
    if (!nombre) continue;
    const pv = numCell(cells[iPv]);
    let lista = buildListaFromRow(cells, header);
    if (!lista && iJson >= 0) lista = parseListaJson(cells[iJson]);
    if (!lista) {
      console.warn(`Sin listas de precio, omitido SKU ${sku}`);
      continue;
    }

    const existencia = iExistencia >= 0 ? numCell(cells[iExistencia]) : 0;
    const categoriaRaw = iCategoria >= 0 ? String(cells[iCategoria] ?? '').trim() : '';
    const categoria = categoriaRaw || 'General';
    const unidadMedida = categoria === 'SERVICIOS' ? 'E48' : 'H87';

    const doc = {
      sku,
      codigoBarras: null,
      nombre,
      descripcion: nombre,
      precioVenta: pv,
      precioCompra: null,
      impuesto: 16,
      existencia,
      existenciaMinima: 0,
      categoria,
      proveedor: null,
      preciosPorListaCliente: lista,
      preciosListaIncluyenIva: false,
      imagen: null,
      unidadMedida,
      claveProdServ: null,
      activo: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const id = productIdForSku(args.sucursal, sku);
    bySku.set(sku, {
      sucursal_id: args.sucursal,
      id,
      doc,
      updated_at: nowIso,
    });
  }

  const toUpsert = [...bySku.values()];
  console.error(`Filas únicas por SKU: ${toUpsert.length}`);

  if (args.dryRun) {
    for (const r of toUpsert.slice(0, 8)) {
      const d = r.doc;
      console.error(`  ${d.sku} | ${d.nombre.slice(0, 48)} | pv=${d.precioVenta} | can=${d.preciosPorListaCliente?.cananea}`);
    }
    console.error('Dry-run: sin escritura.');
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const nombreDisplay =
    args.sucursal.toLowerCase() === 'olivares'
      ? 'Olivares'
      : args.sucursal.charAt(0).toUpperCase() + args.sucursal.slice(1).replace(/_/g, ' ');
  await ensureSucursal(supabase, args.sucursal, nombreDisplay);

  const existingCreated = await fetchExistingCreatedMap(supabase, args.sucursal);

  for (const row of toUpsert) {
    const prev = existingCreated.get(row.id);
    row.doc.createdAt = prev ?? nowIso;
    row.doc.updatedAt = nowIso;
  }

  await flushProducts(supabase, toUpsert, args.batch);
  console.error(`Listo: ${toUpsert.length} producto(s) en public.products (sucursal_id=${args.sucursal}).`);
}

main().catch((e) => {
  console.error(e);
  if (e && typeof e === 'object' && 'cause' in e && e.cause) {
    console.error('Cause:', e.cause);
  }
  process.exit(1);
});
