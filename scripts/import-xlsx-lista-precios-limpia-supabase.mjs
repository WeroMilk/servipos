#!/usr/bin/env node
/**
 * Actualiza precios en public.products desde LISTA_PRECIOS_LIMPIA.xlsx (u otro .xlsx con la misma estructura).
 *
 * Columnas esperadas (primera hoja o nombre coincidente): Codigo, Articulo, Regular, Tecnico,
 * Mayoreo Menor, Mayoreo Mayor, Cananea → precios **con IVA incluido** (ticket y POS muestran ese monto).
 * Se guarda `preciosListaIncluyenIva: true` y `precioVenta` como base **sin IVA** derivada de Regular
 * (coherente con `productListPricing.ts`).
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY (.env.local).
 *
 * Uso:
 *   npm run import:xlsx-lista-precios-limpia -- --file="C:/Users/alfon/Downloads/LISTA_PRECIOS_LIMPIA.xlsx" --sucursal=olivares
 *
 * Opciones: --dry-run, --batch=150, --sheet="Lista Limpia", --lista-sin-iva (si el Excel fuera sin IVA como CSV Olivares)
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

/** Lee .env luego .env.local */
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
    file: '',
    sucursal: 'olivares',
    sheet: '',
    dryRun: false,
    batch: 150,
    /** Si false: mismo criterio que CSV Olivares (importes sin IVA, `preciosListaIncluyenIva: false`). */
    listaPreciosConIva: true,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--lista-sin-iva') out.listaPreciosConIva = false;
    else if (a.startsWith('--file=')) out.file = a.slice('--file='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--sheet=')) out.sheet = a.slice('--sheet='.length).trim();
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 150);
  }
  return out;
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

async function fetchAllProductDocs(supabase, sucursalId) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, doc')
      .eq('sucursal_id', sucursalId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      map.set(row.id, row.doc && typeof row.doc === 'object' ? row.doc : {});
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

/** @returns {number|null} null = celda vacía / omitir */
function parsePrecioCell(v) {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function roundMoney2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function impuestoPctFromDoc(doc) {
  const n = Number(doc?.impuesto);
  return Number.isFinite(n) && n >= 0 ? n : 16;
}

/** precioVenta en BD es siempre base sin IVA; Regular del Excel aquí viene con IVA. */
function regularConIvaToPrecioVentaSinIva(regularConIva, impPct) {
  const factor = 1 + impPct / 100;
  return roundMoney2(regularConIva / factor);
}

/**
 * @param {Record<string, unknown>} row objeto una fila (keys desde cabeceras Excel)
 */
function listaUpdatesFromRow(row) {
  const keys = [
    ['regular', row.Regular ?? row.regular],
    ['tecnico', row.Tecnico ?? row.tecnico],
    ['mayoreo_menos', row['Mayoreo Menor'] ?? row.Mayoreo_Menor],
    ['mayoreo_mas', row['Mayoreo Mayor'] ?? row.Mayoreo_Mayor],
    ['cananea', row.Cananea ?? row.cananea],
  ];
  /** @type {Record<string, number>} */
  const out = {};
  for (const [id, cell] of keys) {
    const n = parsePrecioCell(cell);
    if (n !== null) out[id] = n;
  }
  return out;
}

function normalizeHeaderKey(k) {
  return String(k ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function readListaRows(path, sheetNameOpt) {
  const wb = XLSX.readFile(path);
  const sheetName =
    sheetNameOpt && wb.SheetNames.includes(sheetNameOpt)
      ? sheetNameOpt
      : wb.SheetNames.includes('Lista Limpia')
        ? 'Lista Limpia'
        : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Hoja no encontrada: ${sheetName}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const normRows = rows.map((r) => {
    /** @type {Record<string, unknown>} */
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      o[normalizeHeaderKey(k)] = v;
    }
    return o;
  });
  return { sheetName, rows: normRows };
}

async function main() {
  const args = parseArgs();
  const defaultFile = join(process.env.USERPROFILE || '', 'Downloads', 'LISTA_PRECIOS_LIMPIA.xlsx');
  const filePath = args.file || defaultFile;

  if (!existsSync(filePath)) {
    console.error('No existe el archivo:', filePath);
    console.error('Pase --file="ruta/completa/LISTA_PRECIOS_LIMPIA.xlsx"');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!args.dryRun && (!url || !key)) {
    console.error(
      'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Use --dry-run para solo validar el Excel.\n' +
        '  Supabase → Settings → API → service_role (no anon).'
    );
    process.exit(1);
  }
  if (!args.dryRun && key && jwtPayloadRole(key) !== 'service_role') {
    console.error('La clave JWT no es service_role.');
    process.exit(1);
  }

  const { sheetName, rows } = readListaRows(filePath, args.sheet || '');
  console.error(`Archivo: ${basename(filePath)} · Hoja: ${sheetName} · Filas datos: ${rows.length}`);
  console.error(
    args.listaPreciosConIva
      ? 'Modo: precios en Excel **con IVA** (preciosListaIncluyenIva=true, precioVenta sin IVA).'
      : 'Modo: precios en Excel **sin IVA** (--lista-sin-iva).'
  );

  /** SKU norm → última fila */
  const bySku = new Map();
  for (const r of rows) {
    const cod = normSku(r.Codigo ?? r.codigo ?? r.CODIGO);
    if (!cod) continue;
    bySku.set(cod, r);
  }
  console.error(`Filas con código único (SKU): ${bySku.size}`);

  const nowIso = new Date().toISOString();
  /** @type {{ sucursal_id: string; id: string; doc: Record<string, unknown>; updated_at: string }[]} */
  const toUpsert = [];

  let missingDb = 0;
  let noPrices = 0;

  /** @type {Map<string, Record<string, unknown>> | null} */
  let existingById = null;

  if (!args.dryRun) {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const nombreDisplay =
      args.sucursal.toLowerCase() === 'olivares'
        ? 'Olivares'
        : args.sucursal.charAt(0).toUpperCase() + args.sucursal.slice(1).replace(/_/g, ' ');
    await ensureSucursal(supabase, args.sucursal, nombreDisplay);
    existingById = await fetchAllProductDocs(supabase, args.sucursal);

    /** @type {Map<string, string>} id estable por SKU en inventario */
    const skuToId = new Map();
    for (const [id, doc] of existingById) {
      const sku = normSku(doc.sku);
      if (sku) skuToId.set(sku, id);
    }

    for (const [sku, row] of bySku) {
      const listaPatch = listaUpdatesFromRow(row);
      const pv = parsePrecioCell(row.Regular ?? row.regular);
      if (Object.keys(listaPatch).length === 0 && pv === null) {
        noPrices++;
        continue;
      }

      const id = skuToId.get(sku);
      if (!id) {
        missingDb++;
        continue;
      }

      const base = { ...(existingById.get(id) ?? {}) };
      const prevLista =
        base.preciosPorListaCliente && typeof base.preciosPorListaCliente === 'object'
          ? { ...base.preciosPorListaCliente }
          : {};

      const mergedLista = { ...prevLista, ...listaPatch };
      base.preciosPorListaCliente = mergedLista;
      const impPct = impuestoPctFromDoc(base);
      if (args.listaPreciosConIva) {
        base.preciosListaIncluyenIva = true;
        if (pv !== null) base.precioVenta = regularConIvaToPrecioVentaSinIva(pv, impPct);
      } else {
        base.preciosListaIncluyenIva = false;
        if (pv !== null) base.precioVenta = pv;
      }
      base.updatedAt = nowIso;

      toUpsert.push({
        sucursal_id: args.sucursal,
        id,
        doc: base,
        updated_at: nowIso,
      });
    }

    console.error(`Actualizar en DB: ${toUpsert.length} · SKU sin producto en sucursal: ${missingDb} · Sin precios en fila: ${noPrices}`);
    await flushProducts(supabase, toUpsert, args.batch);
    console.error(`Listo: ${toUpsert.length} producto(s) actualizado(s) (sucursal_id=${args.sucursal}).`);
    return;
  }

  // dry-run
  const impEj = 16;
  for (const [sku, row] of [...bySku.entries()].slice(0, 5)) {
    const listaPatch = listaUpdatesFromRow(row);
    const pv = parsePrecioCell(row.Regular ?? row.regular);
    const pvStored =
      args.listaPreciosConIva && pv !== null ? regularConIvaToPrecioVentaSinIva(pv, impEj) : pv;
    console.error(
      `  SKU ${sku} | Regular(Excel)=${pv} → precioVenta BD=${pvStored} | listas(con IVA en Excel)=${JSON.stringify(listaPatch)}`
    );
  }
  console.error(`Dry-run: ${bySku.size} SKU en Excel (sin escritura). Use sin --dry-run y credenciales para aplicar.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
