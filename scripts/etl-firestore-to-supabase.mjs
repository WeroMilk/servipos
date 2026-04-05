#!/usr/bin/env node
/**
 * Importa un export de Firestore (JSON o NDJSON de `export-firestore-full.mjs`) a Supabase.
 *
 * Requiere variables de entorno:
 *   SUPABASE_URL              — URL del proyecto (ej. https://xxx.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY — clave service_role (solo en servidor/CI, nunca en el cliente)
 *
 * Opciones:
 *   --input=RUTA     Archivo JSON (exportVersion) o NDJSON (--ndjson)
 *   --ndjson         El archivo es una línea por documento { path, data }
 *   --dry-run        Solo cuenta y valida rutas, sin escribir
 *   --batch=N        Filas por upsert (default 200)
 *
 * Orden: sucursales → resto (FK a sucursales). Los documentos `users/{uid}` se omiten:
 * las contraseñas no migran; cree usuarios en Supabase Auth o use reset de contraseña.
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_URL="https://....supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   node scripts/etl-firestore-to-supabase.mjs --input=./firestore-export.json
 */

import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const out = {
    input: join(process.cwd(), 'firestore-export.json'),
    ndjson: false,
    dryRun: false,
    batch: 200,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--ndjson') out.ndjson = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--input=')) out.input = a.slice('--input='.length).trim();
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 200);
  }
  return out;
}

/** Convierte valores serializados por export-firestore-full a JSON puro. */
function normalizeFsValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v !== null && v.__fs === 'Timestamp') {
    if (typeof v.iso === 'string') return v.iso;
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    return new Date().toISOString();
  }
  if (typeof v === 'object' && v !== null && v.__fs === 'GeoPoint') {
    return { lat: v.latitude, lng: v.longitude };
  }
  if (typeof v === 'object' && v !== null && v.__fs === 'DocumentReference') {
    return { _ref: v.path };
  }
  if (typeof v === 'object' && v !== null && v.__fs === 'Bytes') {
    return { _bytes: v.base64 };
  }
  if (Array.isArray(v)) return v.map(normalizeFsValue);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = normalizeFsValue(val);
    }
    return o;
  }
  return v;
}

function isoNow() {
  return new Date().toISOString();
}

function pickUpdatedAt(doc) {
  const u = doc.updatedAt ?? doc.updated_at;
  if (typeof u === 'string' && u.length > 0) return u;
  const c = doc.createdAt ?? doc.created_at;
  if (typeof c === 'string' && c.length > 0) return c;
  return isoNow();
}

function pickCreatedAt(doc) {
  const c = doc.createdAt ?? doc.created_at;
  if (typeof c === 'string' && c.length > 0) return c;
  return isoNow();
}

/** @param {string} path */
function routeDocument(path, rawData) {
  const data = normalizeFsValue(rawData);
  if (typeof data !== 'object' || data === null) return null;
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'users' && parts.length === 2) {
    return { kind: 'skip_users', reason: 'users/{uid} requiere Auth; omitido' };
  }

  if (parts[0] === 'sucursales' && parts.length === 2) {
    const id = parts[1];
    const nombre =
      typeof data.nombre === 'string' && data.nombre.length > 0
        ? data.nombre
        : typeof data.name === 'string' && data.name.length > 0
          ? data.name
          : id;
    const codigo = typeof data.codigo === 'string' && data.codigo.trim() ? data.codigo.trim() : null;
    const activo = data.activo !== false && data.activa !== false;
    return {
      kind: 'sucursales',
      row: {
        id,
        nombre,
        codigo,
        activo,
        created_at: pickCreatedAt(data),
        updated_at: pickUpdatedAt(data),
      },
    };
  }

  if (parts[0] !== 'sucursales' || parts.length < 4) return { kind: 'unknown', path };

  const sucursalId = parts[1];
  const sub = parts[2];
  const docId = parts[3];

  if (sub === 'products' && parts.length === 4) {
    return {
      kind: 'products',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'sales' && parts.length === 4) {
    return {
      kind: 'sales',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'clients' && parts.length === 4) {
    return {
      kind: 'clients',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'inventoryMovements' && parts.length === 4) {
    return {
      kind: 'inventory_movements',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        created_at: pickCreatedAt(data),
      },
    };
  }
  if (sub === 'counters' && parts.length === 4) {
    return {
      kind: 'counters',
      row: {
        sucursal_id: sucursalId,
        counter_id: docId,
        fecha: typeof data.fecha === 'string' ? data.fecha : data.fechaKey ?? null,
        seq: Number(data.seq ?? data.sequence ?? 0) || 0,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'cajaEstado' && parts.length === 4) {
    return {
      kind: 'caja_estado',
      row: {
        sucursal_id: sucursalId,
        doc_id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'cajaSesiones' && parts.length === 4) {
    return {
      kind: 'caja_sesiones',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'config' && parts.length === 4) {
    return {
      kind: 'fiscal_config',
      row: {
        sucursal_id: sucursalId,
        doc_id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'outgoingTransfers' && parts.length === 4) {
    return {
      kind: 'outgoing_transfers',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }
  if (sub === 'incomingTransfers' && parts.length === 4) {
    return {
      kind: 'incoming_transfers',
      row: {
        sucursal_id: sucursalId,
        id: docId,
        doc: data,
        updated_at: pickUpdatedAt(data),
      },
    };
  }

  return { kind: 'unknown', path };
}

async function loadDocuments(input, ndjson) {
  if (!existsSync(input)) {
    throw new Error(`No existe el archivo: ${input}`);
  }
  if (ndjson) {
    const out = [];
    const rl = createInterface({ input: createReadStream(input, { encoding: 'utf8' }) });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      out.push(JSON.parse(t));
    }
    return out;
  }
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  if (raw.documents && Array.isArray(raw.documents)) return raw.documents;
  throw new Error('JSON debe tener { documents: [...] } o use --ndjson');
}

async function flushTable(supabase, table, rows, batchSize, onConflict) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const { input, ndjson, dryRun, batch } = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Defina SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const documents = await loadDocuments(input, ndjson);
  const buckets = {
    sucursales: [],
    products: [],
    sales: [],
    clients: [],
    inventory_movements: [],
    counters: [],
    caja_estado: [],
    caja_sesiones: [],
    fiscal_config: [],
    outgoing_transfers: [],
    incoming_transfers: [],
    app_events: [],
    checador_registros: [],
  };

  let skippedUsers = 0;
  let unknown = 0;

  for (const d of documents) {
    const path = d.path;
    const data = d.data;
    if (typeof path !== 'string') continue;

    if (path.startsWith('appEvents/')) {
      const id = path.split('/')[1];
      buckets.app_events.push({
        id,
        doc: normalizeFsValue(data),
        created_at: pickCreatedAt(normalizeFsValue(data) || {}),
      });
      continue;
    }
    if (path.startsWith('checadorRegistros/')) {
      const id = path.split('/')[1];
      buckets.checador_registros.push({
        id,
        doc: normalizeFsValue(data),
        updated_at: pickUpdatedAt(normalizeFsValue(data) || {}),
      });
      continue;
    }

    const routed = routeDocument(path, data);
    if (!routed) continue;
    if (routed.kind === 'skip_users') {
      skippedUsers++;
      continue;
    }
    if (routed.kind === 'unknown') {
      unknown++;
      if (unknown <= 20) console.warn('Ruta no mapeada:', routed.path);
      continue;
    }

    buckets[routed.kind].push(routed.row);
  }

  console.error(
    `Documentos: ${documents.length} | sucursales: ${buckets.sucursales.length} | productos: ${buckets.products.length} | ventas: ${buckets.sales.length} | omitidos users/: ${skippedUsers} | rutas sin mapear: ${unknown}`
  );

  if (dryRun) {
    console.error('Dry-run: sin escritura.');
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  await flushTable(supabase, 'sucursales', buckets.sucursales, batch, 'id');
  await flushTable(supabase, 'products', buckets.products, batch, 'sucursal_id,id');
  await flushTable(supabase, 'sales', buckets.sales, batch, 'sucursal_id,id');
  await flushTable(supabase, 'clients', buckets.clients, batch, 'sucursal_id,id');
  await flushTable(supabase, 'inventory_movements', buckets.inventory_movements, batch, 'sucursal_id,id');
  await flushTable(supabase, 'counters', buckets.counters, batch, 'sucursal_id,counter_id');
  await flushTable(supabase, 'caja_estado', buckets.caja_estado, batch, 'sucursal_id,doc_id');
  await flushTable(supabase, 'caja_sesiones', buckets.caja_sesiones, batch, 'sucursal_id,id');
  await flushTable(supabase, 'fiscal_config', buckets.fiscal_config, batch, 'sucursal_id,doc_id');
  await flushTable(supabase, 'outgoing_transfers', buckets.outgoing_transfers, batch, 'sucursal_id,id');
  await flushTable(supabase, 'incoming_transfers', buckets.incoming_transfers, batch, 'sucursal_id,id');
  await flushTable(supabase, 'app_events', buckets.app_events, batch, 'id');
  await flushTable(supabase, 'checador_registros', buckets.checador_registros, batch, 'id');

  console.error('Listo: datos importados en Supabase.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
