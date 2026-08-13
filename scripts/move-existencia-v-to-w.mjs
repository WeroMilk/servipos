#!/usr/bin/env node
/**
 * Mueve existenciaPorUbicacion de mueble V → W para SKUs inventariados por error en V.
 *
 * Uso:
 *   node scripts/move-existencia-v-to-w.mjs --dry-run
 *   node scripts/move-existencia-v-to-w.mjs --sucursal=olivares
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

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
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
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

function parseArgs() {
  const out = { sucursal: '', dryRun: false, batch: 100 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--batch=')) {
      out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 100);
    }
  }
  return out;
}

function norm(s) {
  return String(s ?? '')
    .trim()
    .toUpperCase();
}

/** SKUs pedidos (duplicados / casing unificados). */
const SKUS = [
  '1344',
  'W10236142',
  '1361',
  '1705',
  '1105',
  '1050',
  '1181',
  '2199',
  '1370',
  '7503028596454',
  '7503026192399',
  '1898',
  '2276',
  '1866',
  '239D5453G001',
  '1221',
  '2281',
  '1408',
  '2090',
  '2269',
  '197D2038P025',
  '1338',
  '1222',
  '9741',
  '2294',
  '2295',
  '1136',
  '1107',
  '1957',
  '144',
  '2232',
  'EAU65089706',
  '1876',
  '1714',
  '1874',
  '1715',
  '1402',
  '1545',
  '7503044381683',
  'SAMREF02',
  '32132',
];

const WANT = new Set(SKUS.map(norm));

function cloneDoc(doc) {
  try {
    return structuredClone(doc);
  } catch {
    return JSON.parse(JSON.stringify(doc));
  }
}

function parseMap(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = n;
  }
  return out;
}

/**
 * Mueve qty de clave V (o V1..V4) a W, sumando si W ya tiene.
 * Devuelve { next, changed, movedQty, fromKeys, note }.
 */
function moveVtoW(mapIn) {
  const map = { ...mapIn };
  const vKeys = Object.keys(map).filter((k) => {
    const u = k.toUpperCase();
    return u === 'V' || /^V\d+$/.test(u);
  });
  if (vKeys.length === 0) {
    return { next: map, changed: false, movedQty: 0, fromKeys: [], note: 'sin_V' };
  }

  let movedQty = 0;
  for (const k of vKeys) {
    movedQty += map[k] || 0;
    delete map[k];
  }

  const wKey =
    Object.keys(map).find((k) => k.toUpperCase() === 'W') ||
    Object.keys(map).find((k) => /^W\d+$/i.test(k)) ||
    'W';

  // Si hay desglose W1..Wn, consolidamos en letra W (mismo criterio del conteo por mueble).
  // Preferimos la clave canónica 'W' para alinear con MUEBLE_LETRAS.
  const target = 'W';
  // Si había stock en W1..Wn y no en W, sumamos todo a W y limpiamos slots W*.
  for (const k of Object.keys(map)) {
    if (/^W\d+$/i.test(k) || k.toUpperCase() === 'W') {
      if (k !== target) {
        map[target] = (map[target] || 0) + (map[k] || 0);
        delete map[k];
      }
    }
  }
  map[target] = (map[target] || 0) + movedQty;
  if (map[target] <= 0) delete map[target];

  return {
    next: map,
    changed: true,
    movedQty,
    fromKeys: vKeys,
    note: `→${target} (prevWKey=${wKey})`,
  };
}

loadEnvFiles();

const args = parseArgs();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const missing = new Set(WANT);
/** @type {any[]} */
const report = [];
/** @type {{ sucursal_id: string; id: string; doc: Record<string, unknown>; updated_at: string }[]} */
const pending = [];

let from = 0;
for (;;) {
  let q = supabase.from('products').select('sucursal_id,id,doc').range(from, from + 999);
  if (args.sucursal) q = q.eq('sucursal_id', args.sucursal);
  const { data, error } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) break;

  for (const row of data) {
    const d = row.doc || {};
    const sku = String(d.sku ?? '').trim();
    const cb = String(d.codigoBarras ?? '').trim();
    const keys = [sku, cb].map(norm).filter(Boolean);
    if (!keys.some((k) => WANT.has(k))) continue;
    for (const k of keys) missing.delete(k);

    const beforeMap = parseMap(d.existenciaPorUbicacion);
    const { next, changed, movedQty, fromKeys, note } = moveVtoW(beforeMap);
    const ubicBefore = d.ubicacionFisica != null ? String(d.ubicacionFisica).trim() : '';
    const ubicUpper = ubicBefore.toUpperCase();
    const fixUbic =
      ubicUpper === 'V' || /^V\d+$/.test(ubicUpper) ? 'W' : '';

    const entry = {
      sucursal: row.sucursal_id,
      id: row.id,
      sku,
      cb,
      existencia: d.existencia,
      ubicacionFisica: ubicBefore || null,
      beforeMap,
      afterMap: next,
      movedQty,
      fromKeys,
      note,
      fixUbic: fixUbic || null,
      willUpdate: changed || Boolean(fixUbic),
    };
    report.push(entry);

    if (!entry.willUpdate) continue;

    const doc = cloneDoc(d);
    doc.existenciaPorUbicacion = Object.keys(next).length ? next : null;
    if (fixUbic) doc.ubicacionFisica = fixUbic;
    doc.updatedAt = new Date().toISOString();
    pending.push({
      sucursal_id: row.sucursal_id,
      id: row.id,
      doc,
      updated_at: doc.updatedAt,
    });
  }

  if (data.length < 1000) break;
  from += 1000;
}

const outPath = join(process.cwd(), 'exports', 'move-v-to-w-report.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      dryRun: args.dryRun,
      sucursal: args.sucursal || null,
      wanted: [...WANT].sort(),
      missing: [...missing].sort(),
      hits: report.length,
      toUpdate: pending.length,
      report,
    },
    null,
    2
  ),
  'utf8'
);

console.log(`Hits: ${report.length}`);
console.log(`A actualizar: ${pending.length}`);
console.log(`Sin match SKU: ${[...missing].join(', ') || '(ninguno)'}`);
console.log(`Reporte: ${outPath}`);

const withV = report.filter((r) => r.movedQty > 0 || (r.fromKeys && r.fromKeys.length));
console.log(`Con stock/clave en V*: ${withV.length}`);
for (const r of report.filter((r) => r.willUpdate)) {
  console.log(
    `- ${r.sku} [${r.sucursal}] Vqty=${r.movedQty} from=${r.fromKeys.join('|') || '-'} ubic=${r.ubicacionFisica || '-'}→${r.fixUbic || r.ubicacionFisica || '-'} map=${JSON.stringify(r.beforeMap)} → ${JSON.stringify(r.afterMap)}`
  );
}

if (args.dryRun) {
  console.log('Dry-run: no se escribió en Supabase.');
  process.exit(0);
}

for (let i = 0; i < pending.length; i += args.batch) {
  const chunk = pending.slice(i, i + args.batch);
  const { error } = await supabase.from('products').upsert(chunk, { onConflict: 'sucursal_id,id' });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Upsert ${Math.min(i + chunk.length, pending.length)}/${pending.length}`);
}

console.log('Listo.');
