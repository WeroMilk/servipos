#!/usr/bin/env node
/**
 * Revierte el lote más reciente de movimientos "RECEPCIÓN PED-20260723-0001"
 * (salida compensatoria por producto; deja el efecto neto de las recepciones
 * anteriores) y ajusta cantidadRecibida del pedido solo si el PO contaba más
 * de una recepción. Usa service_role con update directo (rpc_adjust_stock
 * exige auth.uid()).
 *
 * Uso:
 *   node scripts/revert-recepcion-duplicada-ped-20260723.mjs
 *   node scripts/revert-recepcion-duplicada-ped-20260723.mjs --sucursal=olivares
 *   node scripts/revert-recepcion-duplicada-ped-20260723.mjs --dry-run
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FOLIO = 'PED-20260723-0001';
const MOTIVO = `RECEPCIÓN ${FOLIO}`;
const MOTIVO_REVERT = `REVERSIÓN DUPLICADO ${MOTIVO}`;

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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function batchKey(iso) {
  // Agrupa por minuto (los 4 clics fueron en minutos distintos: 14:34–14:38).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

function deriveEstado(productos) {
  const fac = productos.reduce((s, it) => s + Math.max(0, Number(it.cantidadFacturada) || 0), 0);
  const rec = productos.reduce((s, it) => s + Math.max(0, Number(it.cantidadRecibida) || 0), 0);
  if (fac <= 0 || rec <= 0) return 'esperando_mercancia';
  if (rec >= fac - 1e-9) return 'completado';
  return 'parcial';
}

loadEnvFiles();
if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const dryRun = hasFlag('dry-run');
const sucursalFilter = (argVal('sucursal') || '').trim().toLowerCase();

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: sucRows, error: sucErr } = await supabase.from('sucursales').select('id');
if (sucErr) {
  console.error(sucErr.message);
  process.exit(1);
}

let sucursalIds = (sucRows ?? []).map((r) => r.id);
if (sucursalFilter) {
  sucursalIds = sucursalIds.filter((id) => String(id).toLowerCase().includes(sucursalFilter));
}
if (sucursalIds.length === 0) {
  console.error('No hay sucursales que coincidan.');
  process.exit(1);
}

let targetSid = null;
let movements = [];

for (const sid of sucursalIds) {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, doc, created_at, sucursal_id')
    .eq('sucursal_id', sid)
    .filter('doc->>motivo', 'eq', MOTIVO)
    .order('created_at', { ascending: true });
  if (error) {
    console.error(sid, error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  if (rows.length > 0) {
    if (targetSid && targetSid !== sid) {
      console.error('Hay movimientos en más de una sucursal; use --sucursal=...');
      process.exit(1);
    }
    targetSid = sid;
    movements = rows;
  }
}

if (!targetSid || movements.length === 0) {
  console.error(`No se encontraron movimientos con motivo «${MOTIVO}».`);
  process.exit(1);
}

const byBatch = new Map();
for (const row of movements) {
  const created = row.created_at || row.doc?.createdAt || '';
  const key = batchKey(created);
  if (!byBatch.has(key)) byBatch.set(key, []);
  byBatch.get(key).push(row);
}

const batchKeys = [...byBatch.keys()].sort();
console.log(`Sucursal: ${targetSid}`);
console.log(`Movimientos totales: ${movements.length}`);
console.log(`Lotes (por minuto): ${batchKeys.length}`);
for (const k of batchKeys) {
  const rows = byBatch.get(k);
  const qty = rows.reduce((s, r) => s + (Number(r.doc?.cantidad) || 0), 0);
  console.log(`  ${k} → ${rows.length} mov(s), qty total ${qty}`);
}

if (batchKeys.length < 4) {
  console.warn(
    `Se esperaban 4 lotes y hay ${batchKeys.length}. Se revertirá igual el lote más reciente si hay ≥2.`
  );
}
if (batchKeys.length < 2) {
  console.error('No hay lotes suficientes para revertir uno y dejar otros.');
  process.exit(1);
}

const newestKey = batchKeys[batchKeys.length - 1];
const newest = byBatch.get(newestKey);
console.log(`\nRevirtiendo lote más reciente: ${newestKey} (${newest.length} movimiento(s))`);
if (dryRun) {
  for (const row of newest) {
    console.log(
      `  [dry-run] salida ${row.doc?.productId} qty=${row.doc?.cantidad} sku/ref=${row.doc?.referencia ?? ''}`
    );
  }
  console.log('Dry-run: no se modificó nada.');
  process.exit(0);
}

/**
 * rpc_adjust_stock exige auth.uid() (sesión de usuario). Con service_role
 * auth.uid() es null → "unauthorized". Replicamos la lógica del RPC aquí.
 */
async function adjustStockSalidaDirect(productId, cantidad) {
  const { data: prodRow, error: prodErr } = await supabase
    .from('products')
    .select('doc')
    .eq('sucursal_id', targetSid)
    .eq('id', productId)
    .maybeSingle();
  if (prodErr) throw new Error(prodErr.message);
  if (!prodRow?.doc) throw new Error(`Producto no encontrado: ${productId}`);

  const doc = { ...(prodRow.doc && typeof prodRow.doc === 'object' ? prodRow.doc : {}) };
  const ant = Math.max(0, Number(doc.existencia) || 0);
  const neu = ant - cantidad;
  const now = new Date().toISOString();
  doc.existencia = neu;
  doc.updatedAt = now;

  const { error: upErr } = await supabase
    .from('products')
    .update({ doc, updated_at: now })
    .eq('sucursal_id', targetSid)
    .eq('id', productId);
  if (upErr) throw new Error(upErr.message);

  const movId = crypto.randomUUID().replace(/-/g, '');
  const { error: movErr } = await supabase.from('inventory_movements').insert({
    sucursal_id: targetSid,
    id: movId,
    doc: {
      productId,
      tipo: 'salida',
      cantidad,
      cantidadAnterior: ant,
      cantidadNueva: neu,
      motivo: MOTIVO_REVERT,
      referencia: `Pedido ${FOLIO} · undo duplicado ${newestKey}`,
      usuarioId: 'system',
      createdAt: now,
    },
    created_at: now,
  });
  if (movErr) throw new Error(movErr.message);
  return { ant, neu };
}

const qtyByProduct = new Map();
for (const row of newest) {
  const productId = String(row.doc?.productId ?? '').trim();
  const cantidad = Math.max(0, Number(row.doc?.cantidad) || 0);
  if (!productId || cantidad <= 0) continue;
  qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + cantidad);

  try {
    const { ant, neu } = await adjustStockSalidaDirect(productId, cantidad);
    console.log(`  OK salida ${productId} −${cantidad} (ex ${ant} → ${neu})`);
  } catch (e) {
    console.error(`Fallo al revertir ${productId}:`, e?.message ?? e);
    process.exit(1);
  }
}

const { data: poRows, error: poErr } = await supabase
  .from('purchase_orders')
  .select('id, doc')
  .eq('sucursal_id', targetSid);
if (poErr) {
  console.error(poErr.message);
  process.exit(1);
}

const po = (poRows ?? []).find((r) => String(r.doc?.folio ?? '') === FOLIO);
if (!po) {
  console.warn(`Pedido ${FOLIO} no encontrado; stock revertido pero no se ajustó el pedido.`);
  process.exit(0);
}

const doc = { ...(po.doc && typeof po.doc === 'object' ? po.doc : {}) };
const productos = Array.isArray(doc.productos) ? doc.productos.map((p) => ({ ...p })) : [];
/**
 * Por el bug original, el pedido suele tener solo 1 recepción persistida aunque
 * el stock se haya aplicado N veces. Restar el lote puede dejar rec=0 e invitar
 * a recibir de nuevo. Solo restamos si rec > sub (había más de una recepción
 * contada en el PO); si no, dejamos rec como estaba.
 */
for (const it of productos) {
  const pid = String(it.productId ?? '').trim();
  const sub = qtyByProduct.get(pid) || 0;
  if (sub <= 0) continue;
  const prev = Math.max(0, Number(it.cantidadRecibida) || 0);
  if (prev > sub + 1e-9) {
    it.cantidadRecibida = Math.max(0, prev - sub);
    console.log(`  Pedido línea ${pid}: cantidadRecibida ${prev} → ${it.cantidadRecibida}`);
  } else {
    console.log(
      `  Pedido línea ${pid}: cantidadRecibida=${prev} se mantiene (stock duplicado no estaba contado en el PO)`
    );
  }
}
doc.productos = productos;
doc.estado = deriveEstado(productos);
doc.updatedAt = new Date().toISOString();

const { error: upErr } = await supabase
  .from('purchase_orders')
  .update({ doc, updated_at: new Date().toISOString() })
  .eq('sucursal_id', targetSid)
  .eq('id', po.id);
if (upErr) {
  console.error('Stock revertido pero falló update del pedido:', upErr.message);
  process.exit(1);
}

console.log(`\nListo. Lotes restantes de «${MOTIVO}»: ${batchKeys.length - 1}. Pedido estado=${doc.estado}`);
