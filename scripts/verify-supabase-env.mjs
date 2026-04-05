#!/usr/bin/env node
/**
 * Comprueba variables Supabase y conectividad básica (sin credenciales de usuario).
 *
 * Lee variables desde el entorno o desde .env en la raíz del repo (líneas KEY=valor).
 *
 * Uso: node scripts/verify-supabase-env.mjs
 *   npm run verify:supabase
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadDotEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function must(name, val) {
  if (!val || String(val).trim() === '') {
    console.error(`Falta o está vacía: ${name}`);
    return false;
  }
  return true;
}

async function main() {
  loadDotEnv();

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const sucursalIds = process.env.VITE_SUCURSAL_IDS;
  const defaultSuc = process.env.VITE_DEFAULT_SUCURSAL_ID;

  let ok = true;
  ok = must('VITE_SUPABASE_URL (o SUPABASE_URL)', url) && ok;
  ok = must('VITE_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY)', anon) && ok;

  if (!ok) {
    console.error('\nCopie .env.example a .env y rellene los valores del proyecto Supabase.');
    process.exit(1);
  }

  const base = String(url).replace(/\/$/, '');
  if (!/^https:\/\/.+\.supabase\.co$/i.test(base) && !/^https:\/\/127\.0\.0\.1/.test(base)) {
    console.warn('Aviso: VITE_SUPABASE_URL no parece una URL típica de Supabase (*.supabase.co).');
  }

  if (sucursalIds) {
    const ids = sucursalIds.split(',').map((s) => s.trim()).filter(Boolean);
    console.error(`VITE_SUCURSAL_IDS: ${ids.length} id(s) → ${ids.join(', ')}`);
    if (defaultSuc && !ids.includes(defaultSuc)) {
      console.warn(`Aviso: VITE_DEFAULT_SUCURSAL_ID="${defaultSuc}" no está en la lista de VITE_SUCURSAL_IDS.`);
    }
  } else {
    console.warn('Aviso: VITE_SUCURSAL_IDS no definido; use ids que existan en public.sucursales.');
  }

  const apiHeaders = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
  };

  try {
    let res = await fetch(`${base}/auth/v1/health`, { method: 'GET', headers: apiHeaders });
    let via = '/auth/v1/health';
    if (!res.ok) {
      /** Sin cabeceras anon, health suele devolver 401; con cabeceras debería ir bien. Si no, PostgREST responde 200 en la raíz del API. */
      res = await fetch(`${base}/rest/v1/`, { method: 'GET', headers: apiHeaders });
      via = '/rest/v1/';
    }
    if (!res.ok) {
      console.error(`Conexión: HTTP ${res.status} en ${via}. Revise VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (Project Settings → API).`);
      process.exit(1);
    }
    console.error(`Conexión: OK (GET ${via} con anon key).`);
  } catch (e) {
    console.error('No se pudo contactar al proyecto:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.error('\nListo. Confirme en Table Editor que existen filas en public.sucursales para esos ids.');
}

main();
