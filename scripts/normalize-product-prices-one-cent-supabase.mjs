#!/usr/bin/env node
/**
 * Normaliza precios en Supabase (`public.products`): si el valor en centavos termina en **01**, pasa a **00**
 * (ej. 950.01 → 950.00).
 *
 * Campos revisados en cada producto (JSON `doc`): `precioVenta`, `precioCompra` / `precio_compra`,
 * `preciosPorListaCliente`, objeto `precios` si existe. No modifica existencias ni otros datos.
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso:
 *   npm run normalize:precios-centavo01-supabase -- --dry-run
 *   npm run normalize:precios-centavo01-supabase -- --sucursal=olivares
 *
 * Opciones: --dry-run, --batch=150
 */

import { existsSync, readFileSync } from 'node:fs';
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
  const out = { sucursal: '', dryRun: false, batch: 150 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 150);
  }
  return out;
}

/** Si los centavos son exactamente 01 (positivos), bajar a .00. */
function normalizeOneCentEnding(raw) {
  if (raw === null || raw === undefined) return { next: raw, changed: false };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { next: raw, changed: false };
  const units = Math.round(n * 100);
  const frac = ((units % 100) + 100) % 100;
  if (frac !== 1) return { next: n, changed: false };
  const newUnits = units > 0 ? units - 1 : units + 1;
  return { next: newUnits / 100, changed: true };
}

function normalizeListaLike(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  let touched = false;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'number' || (typeof v === 'string' && String(v).trim() !== '' && Number.isFinite(Number(v)))) {
      const { next, changed } = normalizeOneCentEnding(v);
      if (changed) {
        obj[key] = next;
        touched = true;
      }
    }
  }
  return touched;
}

/**
 * @returns {boolean} si el doc cambió
 */
function normalizeProductDocPrices(doc) {
  if (!doc || typeof doc !== 'object') return false;
  let changed = false;

  if ('precioVenta' in doc && doc.precioVenta != null) {
    const { next, changed: c } = normalizeOneCentEnding(doc.precioVenta);
    if (c) {
      doc.precioVenta = next;
      changed = true;
    }
  }

  for (const pk of ['precioCompra', 'precio_compra']) {
    if (!(pk in doc) || doc[pk] === null || doc[pk] === undefined || doc[pk] === '') continue;
    const { next, changed: c } = normalizeOneCentEnding(doc[pk]);
    if (c) {
      doc[pk] = next;
      changed = true;
    }
  }

  if (doc.preciosPorListaCliente != null && typeof doc.preciosPorListaCliente === 'object') {
    if (normalizeListaLike(doc.preciosPorListaCliente)) changed = true;
  }

  if (doc.precios != null && typeof doc.precios === 'object' && !Array.isArray(doc.precios)) {
    if (normalizeListaLike(doc.precios)) changed = true;
  }

  return changed;
}

async function flushProducts(supabase, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('products').upsert(chunk, { onConflict: 'sucursal_id,id' });
    if (error) throw new Error(error.message);
  }
}

function cloneDoc(doc) {
  try {
    return structuredClone(doc);
  } catch {
    return JSON.parse(JSON.stringify(doc));
  }
}

async function main() {
  const args = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  Añada SUPABASE_SERVICE_ROLE_KEY en .env.local (service_role).'
    );
    process.exit(1);
  }
  if (jwtPayloadRole(key) !== 'service_role') {
    console.error('Use la clave service_role, no anon.');
    process.exit(1);
  }

  let changedDocs = 0;
  let scanned = 0;
  /** @type {{ sucursal_id: string; sku: string; id: string }[]} */
  const samples = [];

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let from = 0;
  const pageSize = 500;
  /** @type {{ sucursal_id: string; id: string; doc: Record<string, unknown>; updated_at: string }[]} */
  const pending = [];
  const ts = () => new Date().toISOString();

  const flushOneBatch = async () => {
    if (args.dryRun || pending.length < args.batch) return;
    const chunk = pending.splice(0, args.batch);
    await flushProducts(supabase, chunk, args.batch);
  };

  while (true) {
    let q = supabase.from('products').select('sucursal_id, id, doc').range(from, from + pageSize - 1);
    if (args.sucursal) q = q.eq('sucursal_id', args.sucursal);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    for (const row of rows) {
      scanned++;
      const docRaw = row.doc && typeof row.doc === 'object' ? row.doc : null;
      if (!docRaw) continue;
      const doc = cloneDoc(docRaw);
      const sku = String(doc.sku ?? '').trim() || row.id;
      if (!normalizeProductDocPrices(doc)) continue;
      changedDocs++;
      if (samples.length < 15) {
        samples.push({ sucursal_id: row.sucursal_id, id: row.id, sku });
      }
      doc.updatedAt = ts();
      if (!args.dryRun) {
        pending.push({
          sucursal_id: row.sucursal_id,
          id: row.id,
          doc,
          updated_at: ts(),
        });
        await flushOneBatch();
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  if (!args.dryRun && pending.length > 0) {
    await flushProducts(supabase, pending, args.batch);
  }

  const modo = args.dryRun ? 'Simulación (--dry-run): sin escritura.' : 'Listo.';
  console.error(`${modo} Escaneados: ${scanned}. Habrían cambiado / cambiaron precios (…01→…00): ${changedDocs}.`);
  if (samples.length > 0) {
    console.error('Ejemplos de SKU:');
    for (const s of samples) {
      console.error(`  ${s.sucursal_id} · ${s.sku}`);
    }
  }
  if (args.dryRun && changedDocs > 0) {
    console.error('Quite --dry-run para aplicar los cambios en Supabase.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
