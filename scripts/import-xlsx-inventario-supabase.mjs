#!/usr/bin/env node
/**
 * Actualiza catálogo y existencias desde una carpeta de Excel (una hoja por archivo; columnas tipo Olivares).
 * Conserva precios y datos fiscales/compra ya guardados en Supabase si el Excel no los trae.
 *
 * Categoría SERVICIOS (archivo SERVICIOS.xlsx): existencia 0, `esServicio: true`, unidad E48 — el POS y los RPC
 * no descuentan stock (tras aplicar migración `20260505120000_inferencias_servicio_sin_stock.sql`).
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso:
 *   npm run import:xlsx-inventario-supabase -- --dir="C:/Users/alfon/Downloads" --sucursal=olivares --ultimo-gana
 *
 * Opciones:
 *   --dry-run
 *   --ultimo-gana       Mismo SKU en varios .xlsx: se conserva el último archivo (orden alfabético por nombre de archivo)
 *   --dir-include-all-xlsx Procesa todos los .xlsx del directorio (por defecto solo los 15 Excels de categoría SERVIPOS listados abajo)
 *   --files=a.xlsx,b.xlsx Lista explícita de archivos (basenames) si no usa el conjunto por defecto
 *   --incluir-ref-id    Incluye columna ID en descripción (comportamiento Olivares)
 *   --deactivate-missing Marca activo=false los productos de la sucursal cuyo SKU no aparece en ningún Excel
 *   --batch=150
 *   --sucursal-nombre=...
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { mergeRowsFromDir, disambiguateNombres, buildDescripcion } from './lib/olivaresInventoryFromDir.mjs';
import { unidadSatProductoOlivares } from './lib/olivaresUnidadSat.mjs';
import { LIST_KEYS } from './lib/olivaresRtfPrecios.mjs';

/** Excels de categoría SERVIPOS (solo estos se leen si no pasa --dir-include-all-xlsx). */
const DEFAULT_CATEGORY_XLSX = [
  'ABANICOS.xlsx',
  'ACCESORIOS.xlsx',
  'AIRE ACONDICIONADO.xlsx',
  'BOILER.xlsx',
  'COOLER.xlsx',
  'ESTUFAS.xlsx',
  'GASES.xlsx',
  'GENERAL.xlsx',
  'LAVADORAS.xlsx',
  'LICUADORAS.xlsx',
  'OLLAS DE PRESION.xlsx',
  'REFRIGERACION.xlsx',
  'SECADORAS.xlsx',
  'SERVICIOS.xlsx',
  'VITRINAS.xlsx',
];

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
    sucursal: 'olivares',
    sucursalNombre: '',
    dryRun: false,
    ultimoGana: false,
    dirIncludeAllXlsx: false,
    filesExplicit: '',
    incluirRefId: false,
    deactivateMissing: false,
    batch: 150,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--ultimo-gana') out.ultimoGana = true;
    else if (a === '--dir-include-all-xlsx') out.dirIncludeAllXlsx = true;
    else if (a === '--incluir-ref-id') out.incluirRefId = true;
    else if (a === '--deactivate-missing') out.deactivateMissing = true;
    else if (a.startsWith('--files=')) out.filesExplicit = a.slice('--files='.length).trim();
    else if (a.startsWith('--dir=')) out.dir = a.slice('--dir='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--sucursal-nombre=')) out.sucursalNombre = a.slice('--sucursal-nombre='.length).trim();
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

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function coalesceLista(prev) {
  const pl = prev?.preciosPorListaCliente;
  const o = {};
  for (const k of LIST_KEYS) {
    const v = pl && typeof pl === 'object' ? pl[k] : undefined;
    o[k] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return o;
}

function buildInventoryDoc({ r, prev, nowIso, createdAt, incluirRefId }) {
  const cat = String(r.categoria ?? '').trim();
  const esServicio = cat.toUpperCase() === 'SERVICIOS';
  const unidadMedida = esServicio ? 'E48' : unidadSatProductoOlivares(r.nombre, cat, prev?.unidadMedida);
  const existencia = esServicio
    ? 0
    : unidadMedida === 'MTR' || unidadMedida === 'CMT'
      ? Math.max(0, Math.round(num(r.existencia) * 1000) / 1000)
      : Math.max(0, Math.round(num(r.existencia)));
  const lista = coalesceLista(prev);
  const precioVenta =
    prev != null && typeof prev.precioVenta === 'number' && Number.isFinite(prev.precioVenta)
      ? prev.precioVenta
      : lista.regular ?? 0;

  const descExcel = buildDescripcion(r, incluirRefId);
  const descripcion =
    descExcel != null && String(descExcel).trim() !== ''
      ? descExcel
      : prev?.descripcion != null && String(prev.descripcion).trim() !== ''
        ? String(prev.descripcion)
        : null;

  let preciosListaIncluyenIva = null;
  if (prev?.preciosListaIncluyenIva === true) preciosListaIncluyenIva = true;
  else if (prev?.preciosListaIncluyenIva === false) preciosListaIncluyenIva = false;

  return {
    sku: r.sku,
    codigoBarras: prev?.codigoBarras != null && String(prev.codigoBarras).trim() !== '' ? String(prev.codigoBarras) : null,
    nombre: r.nombre,
    descripcion,
    precioVenta,
    precioCompra:
      prev?.precioCompra != null && String(prev.precioCompra).trim() !== ''
        ? num(prev.precioCompra)
        : null,
    impuesto: num(prev?.impuesto, 16),
    existencia,
    existenciaMinima: 0,
    categoria: cat,
    proveedor: prev?.proveedor != null ? String(prev.proveedor) : null,
    preciosPorListaCliente: lista,
    preciosListaIncluyenIva,
    imagen: prev?.imagen != null ? String(prev.imagen) : null,
    unidadMedida,
    claveProdServ:
      prev?.claveProdServ != null && String(prev.claveProdServ).replace(/\D/g, '').length === 8
        ? String(prev.claveProdServ).replace(/\D/g, '').slice(0, 8)
        : null,
    esServicio: esServicio ? true : null,
    activo: true,
    createdAt,
    updatedAt: nowIso,
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

async function fetchExistingDocsMap(supabase, sucursalId) {
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
      if (row.doc && typeof row.doc === 'object') map.set(row.id, row.doc);
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

async function deactivateProductsMissingFromImport(supabase, sucursalId, keepIds, batchSize) {
  const nowIso = new Date().toISOString();
  let from = 0;
  const pageSize = 500;
  let deactivated = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, doc')
      .eq('sucursal_id', sucursalId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const updates = [];
    for (const row of rows) {
      if (keepIds.has(row.id)) continue;
      const doc = row.doc && typeof row.doc === 'object' ? { ...row.doc } : {};
      if (doc.activo === false) continue;
      doc.activo = false;
      doc.updatedAt = nowIso;
      updates.push({ sucursal_id: sucursalId, id: row.id, doc, updated_at: nowIso });
    }
    if (updates.length > 0) await flushProducts(supabase, updates, batchSize);
    deactivated += updates.length;
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return deactivated;
}

async function main() {
  const args = parseArgs();
  if (!args.dir || !existsSync(args.dir)) {
    console.error('Indique una carpeta válida con --dir=... (donde están los .xlsx por categoría).');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!args.dryRun && (!url || !key)) {
    console.error(
      'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  Añada SUPABASE_SERVICE_ROLE_KEY en .env.local (service_role del panel Supabase).'
    );
    process.exit(1);
  }
  if (!args.dryRun && key && jwtPayloadRole(key) !== 'service_role') {
    console.error('La clave no es service_role. Use la clave service_role, no anon.');
    process.exit(1);
  }

  const mergeOpts =
    args.dirIncludeAllXlsx ?
      {}
    : {
        onlyBasenames:
          args.filesExplicit.trim().length > 0 ?
            args.filesExplicit.split(',').map((s) => s.trim()).filter(Boolean)
          : DEFAULT_CATEGORY_XLSX,
      };

  let merged;
  try {
    merged = mergeRowsFromDir(args.dir, args.ultimoGana, mergeOpts);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (merged.duplicateSkus.length > 0) {
    console.error(`Advertencia: ${merged.duplicateSkus.length} SKU duplicado(s) entre archivos (último archivo ${args.ultimoGana ? 'conserva' : 'NO conserva — use --ultimo-gana'}).`);
    for (const d of merged.duplicateSkus.slice(0, 12)) {
      console.error(`  ${d.sku}: ${d.first} vs ${d.second}`);
    }
    if (merged.duplicateSkus.length > 12) console.error('  …');
  }

  const rows = [...merged.bySku.values()];
  disambiguateNombres(rows);

  console.error(`Filas importadas (SKU únicos): ${rows.length}`);
  for (const pf of merged.perFile) {
    console.error(`  ${pf.file}: ${pf.count} filas (${pf.skipped} omitidas)`);
  }

  if (args.dryRun) {
    const sample = rows.find((x) => String(x.categoria).toUpperCase() === 'SERVICIOS');
    if (sample)
      console.error(`Ej. servicio: SKU ${sample.sku} · ${sample.nombre.length > 50 ? `${sample.nombre.slice(0, 50)}…` : sample.nombre}`);
    const phy = rows.find((x) => String(x.categoria).toUpperCase() !== 'SERVICIOS');
    if (phy) console.error(`Ej. físico: SKU ${phy.sku} · existencia(origen Excel)=${phy.existencia}`);
    console.error('Dry-run: sin escritura.');
    return;
  }

  const nowIso = new Date().toISOString();
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const nombreDisplay =
    args.sucursalNombre.trim() ||
    (args.sucursal.toLowerCase() === 'olivares'
      ? 'Olivares'
      : args.sucursal.charAt(0).toUpperCase() + args.sucursal.slice(1).replace(/_/g, ' '));
  await ensureSucursal(supabase, args.sucursal, nombreDisplay);

  const existingById = await fetchExistingDocsMap(supabase, args.sucursal);
  const toUpsert = [];
  for (const r of rows) {
    const id = productIdForSku(args.sucursal, r.sku);
    const prev = existingById.get(id);
    const createdAt =
      prev && typeof prev.createdAt === 'string' && prev.createdAt.trim() !== '' ? prev.createdAt : nowIso;
    const doc = buildInventoryDoc({
      r,
      prev,
      nowIso,
      createdAt,
      incluirRefId: args.incluirRefId,
    });
    toUpsert.push({
      sucursal_id: args.sucursal,
      id,
      doc,
      updated_at: nowIso,
    });
  }

  await flushProducts(supabase, toUpsert, args.batch);
  console.error(`Listo: ${toUpsert.length} producto(s) actualizado(s) en public.products (sucursal_id=${args.sucursal}).`);

  if (args.deactivateMissing) {
    const keep = new Set(toUpsert.map((x) => x.id));
    const n = await deactivateProductsMissingFromImport(supabase, args.sucursal, keep, args.batch);
    console.error(`Productos marcados inactivos (no venían en los Excel): ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
