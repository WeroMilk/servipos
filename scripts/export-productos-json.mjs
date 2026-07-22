#!/usr/bin/env node
/**
 * Exporta todos los productos activos a JSON (para generar Word).
 * Requiere SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso:
 *   node scripts/export-productos-json.mjs
 *   node scripts/export-productos-json.mjs --sucursal=olivares
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
        if (key && process.env[key] == null) process.env[key] = val;
      }
    } catch {
      /* noop */
    }
  }
}

function argVal(name) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

loadEnvFiles();
if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env / .env.local');
  process.exit(1);
}

const sucursalFilter = (argVal('sucursal') || '').trim().toLowerCase();

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const pageSize = 1000;
let from = 0;
const rows = [];

for (;;) {
  let q = supabase.from('products').select('sucursal_id, id, doc').range(from, from + pageSize - 1);
  if (sucursalFilter) q = q.eq('sucursal_id', sucursalFilter);
  const { data, error } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) break;
  rows.push(...data);
  if (data.length < pageSize) break;
  from += pageSize;
}

const products = rows
  .map((r) => {
    const d = r.doc && typeof r.doc === 'object' ? r.doc : {};
    const activo = d.activo !== false;
    return {
      sucursalId: r.sucursal_id,
      id: r.id,
      activo,
      sku: String(d.sku ?? '').trim(),
      nombre: String(d.nombre ?? '').trim(),
      codigoBarras: String(d.codigoBarras ?? d.codigo_barras ?? '').trim(),
      categoria: String(d.categoria ?? '').trim(),
      existencia: Number(d.existencia) || 0,
      ubicacionFisica: String(d.ubicacionFisica ?? '').trim(),
      esServicio: d.esServicio === true || String(d.categoria ?? '').toUpperCase() === 'SERVICIOS',
    };
  })
  .filter((p) => p.activo && p.nombre)
  .sort((a, b) => {
    const c = a.categoria.localeCompare(b.categoria, 'es');
    if (c !== 0) return c;
    return a.nombre.localeCompare(b.nombre, 'es');
  });

const outDir = join(process.cwd(), 'exports');
mkdirSync(outDir, { recursive: true });
const outJson = join(outDir, 'productos-catalogo.json');
writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), count: products.length, products }, null, 2), 'utf8');
console.log(`OK ${products.length} productos → ${outJson}`);
