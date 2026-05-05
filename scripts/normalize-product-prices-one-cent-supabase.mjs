#!/usr/bin/env node
/**
 * Normaliza precios en Supabase (`public.products`): si el valor en centavos termina en **01**, pasa a **00**
 * (ej. 950.01 → 950.00).
 *
 * Campos: cualquier clave que parezca precio (`precio*`, `lista*`, listas mayoreo/técnico/cananea, etc.),
 * más todo el contenido de `preciosPorListaCliente` y `precios`. Interpreta montos en string con coma o punto.
 * No modifica existencias, impuesto, cantidades ni descuentos porcentuales en `descuento`.
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

/** Campos numéricos que no son montos (no tocar). */
const NEVER_NORMALIZE_KEYS = new Set([
  'existencia',
  'existenciaminima',
  'impuesto',
  'cantidad',
  'cantidadanterior',
  'cantidadnueva',
  'descuento',
  'stock',
]);

/** Subárboles donde todo número/cadena monetaria se normaliza (objeto anidado). */
const MONEY_SUBTREE_KEYS = new Set(['preciosporlistacliente', 'precios']);

/**
 * Interpreta número guardado como number o string (coma/punto, miles).
 */
function parseMoneyScalar(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return parseMoneyScalar(/** @type {{ value?: unknown }} */ (raw).value);
  }
  if (typeof raw !== 'string') return NaN;
  let s = raw.trim().replace(/^\$/, '').replace(/\s/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Si los centavos son exactamente .01, pasar a .00 (ej. 950.01 → 950). */
function normalizeOneCentEnding(raw) {
  const n = parseMoneyScalar(raw);
  if (!Number.isFinite(n)) return { next: raw, changed: false };
  const units = Math.round(n * 100);
  const frac = ((units % 100) + 100) % 100;
  if (frac !== 1) return { next: n, changed: false };
  const newUnits = units > 0 ? units - 1 : units + 1;
  return { next: newUnits / 100, changed: true };
}

function keyLooksLikePriceKey(key) {
  const x = key.toLowerCase();
  if (NEVER_NORMALIZE_KEYS.has(x)) return false;
  if (x.includes('existencia')) return false;
  if (x.includes('precio')) return true;
  if (x.startsWith('lista')) return true;
  if (x.includes('mayoreo') || x.includes('tecnico') || x.includes('cananea')) return true;
  if (x.includes('regular') && x.includes('iva')) return true;
  if (x === 'subtotal' || x === 'total') return true;
  return false;
}

function looksLikeMoneyString(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  return /^[\s$-]?[\d.,]+$/.test(t);
}

/**
 * Recorre `doc` y corrige …01 → …00 en cualquier precio conocido o dentro de mapas de precios.
 * @returns {boolean} si el doc cambió
 */
function normalizeProductDocPrices(doc) {
  if (!doc || typeof doc !== 'object') return false;
  let changed = false;

  /**
   * @param {unknown} obj
   * @param {boolean} insideMoneySubtree
   */
  function walk(obj, insideMoneySubtree) {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, insideMoneySubtree);
      return;
    }
    if (typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
      const kl = key.toLowerCase();
      const v = /** @type {Record<string, unknown>} */ (obj)[key];
      const subtree =
        insideMoneySubtree ||
        MONEY_SUBTREE_KEYS.has(kl);

      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, subtree || MONEY_SUBTREE_KEYS.has(kl));
        continue;
      }

      const normalizeThisLeaf =
        subtree ||
        (keyLooksLikePriceKey(key) && !NEVER_NORMALIZE_KEYS.has(kl));

      if (!normalizeThisLeaf) continue;

      if (typeof v === 'number') {
        const { next, changed: c } = normalizeOneCentEnding(v);
        if (c) {
          /** @type {Record<string, unknown>} */ (obj)[key] = next;
          changed = true;
        }
        continue;
      }
      if (typeof v === 'string' && looksLikeMoneyString(v)) {
        const parsed = parseMoneyScalar(v);
        if (!Number.isFinite(parsed)) continue;
        const { next, changed: c } = normalizeOneCentEnding(parsed);
        if (c) {
          /** @type {Record<string, unknown>} */ (obj)[key] = next;
          changed = true;
        }
      }
    }
  }

  walk(doc, false);
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
