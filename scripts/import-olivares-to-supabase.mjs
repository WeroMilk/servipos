#!/usr/bin/env node
/**
 * Importa inventario (.xlsx por carpeta) + lista de precios (.rtf) a Supabase
 * (tabla public.products para la sucursal indicada).
 *
 * Reglas de precios (igual que merge-olivares-precios-rtf.mjs):
 *   Cananea = precio con IVA con centavos (o el menor si ninguno tiene centavos);
 *   Regular / técnico / mayoreo − / mayoreo + = los otros cuatro, de mayor a menor.
 *   Se guardan sin IVA en doc.preciosPorListaCliente y preciosListaIncluyenIva: false.
 *
 * Requiere:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso (Git Bash / PowerShell):
 *   export SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   node scripts/import-olivares-to-supabase.mjs --dir="C:/Users/.../inventario abril 2026..." --rtf="C:/Users/.../lista de precios.rtf" --sucursal=olivares
 *
 * Opciones:
 *   --dry-run
 *   --ultimo-gana          Mismo SKU en varios Excel: quedarse con el último archivo
 *   --incluir-ref-id
 *   --strict-precios       Falla si un producto no tiene match en el RTF
 *   --iva=16
 *   --sin-iva-en-rtf
 *   --pad-5
 *   --sucursal-nombre=...  Texto para crear fila en public.sucursales si no existe (default: id capitalizado)
 *   --batch=150
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  parsePreciosRtf,
  buildPrecioIndexes,
  matchRowToPrecios,
  preciosConIvaToSinIvaRecord,
  loadRtfTextFromFile,
  LIST_KEYS,
} from './lib/olivaresRtfPrecios.mjs';
import { mergeRowsFromDir, disambiguateNombres, buildDescripcion } from './lib/olivaresInventoryFromDir.mjs';

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
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--ultimo-gana') out.ultimoGana = true;
    else if (a === '--incluir-ref-id') out.incluirRefId = true;
    else if (a === '--strict-precios') out.strictPrecios = true;
    else if (a === '--sin-iva-en-rtf') out.sinIvaEnRtf = true;
    else if (a === '--pad-5') out.pad5 = true;
    else if (a.startsWith('--dir=')) out.dir = a.slice('--dir='.length).trim();
    else if (a.startsWith('--rtf=')) out.rtf = a.slice('--rtf='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--sucursal-nombre=')) out.sucursalNombre = a.slice('--sucursal-nombre='.length).trim();
    else if (a.startsWith('--iva=')) out.ivaPct = Number(a.slice('--iva='.length)) || 16;
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 150);
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

function buildProductDoc(r, recSinIva, incluirRefId, createdAtIso, updatedAtIso) {
  const unidadMedida = r.categoria === 'SERVICIOS' ? 'E48' : 'H87';
  const descripcion = buildDescripcion(r, incluirRefId);
  const precioVenta = recSinIva.regular ?? 0;
  const lista = {};
  for (const k of LIST_KEYS) {
    lista[k] = recSinIva[k] ?? 0;
  }
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
    console.error('No existe el RTF:', args.rtf);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!args.dryRun && (!url || !key)) {
    console.error('Defina SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o use --dry-run).');
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

  const rtfText = loadRtfTextFromFile(args.rtf);
  const preciosMap = parsePreciosRtf(rtfText, { pad5: args.pad5 });
  const idx = buildPrecioIndexes(preciosMap);

  if (idx.nombreDup.length) {
    console.error(`Aviso: ${idx.nombreDup.length} nombre(es) repetido(s) en RTF (última aparición gana).`);
  }
  if (idx.nombreLooseDup.length) {
    console.error(`Aviso: ${idx.nombreLooseDup.length} nombre(s) suelto(s) repetido(s) en RTF.`);
  }

  console.error(`RTF: ${preciosMap.size} productos con 5 precios parseados.`);
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
      missingPrecio.push(r.sku);
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
    console.error('Primeros SKUs sin RTF:', missingPrecio.slice(0, 40).join(', '));
    throw new Error(`--strict-precios: ${missingPrecio.length} producto(s) sin lista de precios.`);
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

  const existingCreated = new Map();
  {
    const idList = [...new Set(toUpsert.map((x) => x.id))];
    const chunk = 500;
    for (let i = 0; i < idList.length; i += chunk) {
      const slice = idList.slice(i, i + chunk);
      const { data, error } = await supabase
        .from('products')
        .select('id, doc')
        .eq('sucursal_id', args.sucursal)
        .in('id', slice);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const ca = row.doc && typeof row.doc.createdAt === 'string' ? row.doc.createdAt : null;
        if (ca) existingCreated.set(row.id, ca);
      }
    }
  }

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
    console.error(`Advertencia: ${missingPrecio.length} SKU(s) sin match en RTF → no importados.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
