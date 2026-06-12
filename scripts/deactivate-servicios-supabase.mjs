#!/usr/bin/env node
/**
 * Da de baja (activo=false) todos los productos servicio en Supabase:
 * `doc.esServicio === true` o `doc.categoria` = SERVICIOS (sin importar mayúsculas).
 *
 * Requiere: SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso:
 *   npm run deactivate:servicios-supabase -- --dry-run
 *   npm run deactivate:servicios-supabase -- --sucursal=olivares
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

function productEsServicio(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.esServicio === true) return true;
  return String(doc.categoria ?? '').trim().toUpperCase() === 'SERVICIOS';
}

function cloneDoc(doc) {
  try {
    return structuredClone(doc);
  } catch {
    return JSON.parse(JSON.stringify(doc));
  }
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

  let scanned = 0;
  let matched = 0;
  /** @type {{ sucursal_id: string; sku: string; id: string; nombre: string }[]} */
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
      if (docRaw.activo === false) continue;
      if (!productEsServicio(docRaw)) continue;

      matched++;
      const sku = String(docRaw.sku ?? '').trim() || row.id;
      const nombre = String(docRaw.nombre ?? '').trim() || sku;
      if (samples.length < 20) {
        samples.push({ sucursal_id: row.sucursal_id, id: row.id, sku, nombre });
      }

      if (!args.dryRun) {
        const doc = cloneDoc(docRaw);
        doc.activo = false;
        doc.updatedAt = ts();
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
  console.error(`${modo} Escaneados: ${scanned}. Servicios dados de baja: ${matched}.`);
  if (samples.length > 0) {
    console.error('Muestra:');
    for (const s of samples) {
      console.error(`  [${s.sucursal_id}] ${s.sku} — ${s.nombre}`);
    }
    if (matched > samples.length) {
      console.error(`  … y ${matched - samples.length} más.`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
