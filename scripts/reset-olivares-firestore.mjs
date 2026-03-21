#!/usr/bin/env node
/**
 * Reset duro de una sucursal en Firestore:
 * - Ventas (sales)
 * - Inventario: productos + movimientos (products, inventoryMovements)
 * - Contadores bajo sucursales/{id}/counters (p. ej. folio diario)
 * - Checador: registros con sucursalId = sucursal, y registros sin sucursal (null/vacío)
 *   cuyo userId está en users con sucursalId = sucursal (fichajes viejos sin campo).
 *
 * Requiere GOOGLE_APPLICATION_CREDENTIALS → JSON de cuenta de servicio (Firestore).
 *
 * Uso:
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\serviceAccount.json
 *   node scripts/reset-olivares-firestore.mjs
 *
 * Opciones:
 *   --sucursal=olivares   (default: olivares)
 *   --project=ID
 *   --dry-run
 *
 * IndexedDB (POSMexicoDB): ventas/clientes/cotiz/facturas locales → docs/RESET_OLIVARES.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readDefaultProjectId() {
  try {
    const rc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));
    const first = Object.values(rc.projects || {})[0];
    if (typeof first === 'string') return first;
  } catch {
    /* ignore */
  }
  return 'servipartzpos-26417';
}

function parseArgs() {
  const out = {
    sucursal: 'olivares',
    project: process.env.FIREBASE_PROJECT_ID || readDefaultProjectId(),
    dryRun: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length).trim();
  }
  return out;
}

async function deleteQueryUntilEmpty(baseQuery, label, dryRun) {
  const db = admin.firestore();
  if (dryRun) {
    const agg = await baseQuery.count().get();
    console.log(`[dry-run] ${label}: ${agg.data().count} documento(s)`);
    return;
  }
  let total = 0;
  for (;;) {
    const snap = await baseQuery.limit(500).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    console.log(`  ${label}: +${snap.size} eliminados (total ${total})`);
    if (snap.size < 500) break;
  }
  if (total === 0) console.log(`  ${label}: (ya vacío)`);
}

/** users/{uid} con sucursalId asignada a la tienda (perfil actual). */
async function loadUserIdsForSucursal(db, sucursalId) {
  const snap = await db.collection('users').where('sucursalId', '==', sucursalId).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function wipeChecador(db, sucursalId, olivaresUserIds, dryRun) {
  const col = db.collection('checadorRegistros');
  const label = 'checadorRegistros (por sucursalId)';
  await deleteQueryUntilEmpty(col.where('sucursalId', '==', sucursalId), label, dryRun);

  const ids = [...olivaresUserIds];
  if (ids.length === 0) {
    console.log('checadorRegistros (legado sin sucursal): sin userIds en users con esta sucursal; omitido.');
    return;
  }

  console.log(
    `\nchecadorRegistros (legado: userId en ${ids.length} usuario(s) de la tienda, sin sucursalId) …`
  );
  let legacyTotal = 0;
  const chunkSize = 10;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const q = col.where('userId', 'in', chunk);
    const snap = await q.get();
    const toRemove = snap.docs.filter((d) => {
      const data = d.data();
      const sid = data.sucursalId;
      const noBranch = sid == null || sid === '';
      return noBranch && chunk.includes(data.userId);
    });
    if (toRemove.length === 0) continue;
    if (dryRun) {
      legacyTotal += toRemove.length;
      console.log(`[dry-run] legado: ${toRemove.length} docs (chunk userId in [...])`);
      continue;
    }
    const batch = db.batch();
    toRemove.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    legacyTotal += toRemove.length;
    console.log(`  legado: +${toRemove.length} eliminados (total ${legacyTotal})`);
  }
  if (legacyTotal === 0 && !dryRun) console.log('  legado: (nada que borrar)');
}

async function main() {
  const { sucursal, project, dryRun } = parseArgs();

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !existsSync(credPath)) {
    console.error(
      'Falta GOOGLE_APPLICATION_CREDENTIALS apuntando a un JSON de cuenta de servicio (ruta válida).'
    );
    process.exit(1);
  }

  console.log(`Proyecto: ${project}`);
  console.log(`Sucursal: ${sucursal}`);
  console.log(dryRun ? 'MODO DRY-RUN (no se borra nada)\n' : '¡Se eliminarán datos en Firestore!\n');

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: project,
  });

  const db = admin.firestore();
  const sucRef = db.collection('sucursales').doc(sucursal);

  const subcols = ['sales', 'inventoryMovements', 'products'];
  for (const name of subcols) {
    const colRef = sucRef.collection(name);
    console.log(`Colección sucursales/${sucursal}/${name} …`);
    if (dryRun) {
      const c = await colRef.count().get();
      console.log(`[dry-run] documentos: ${c.data().count}`);
      continue;
    }
    await db.recursiveDelete(colRef);
    console.log(`  OK (recursiveDelete)`);
  }

  console.log(`\nSubcolección sucursales/${sucursal}/counters …`);
  const countersCol = sucRef.collection('counters');
  if (dryRun) {
    const c = await countersCol.count().get();
    console.log(`[dry-run] documentos en counters: ${c.data().count}`);
  } else {
    await db.recursiveDelete(countersCol);
    console.log('  OK (recursiveDelete counters)');
  }

  const olivaresUserIds = await loadUserIdsForSucursal(db, sucursal);
  console.log(`\nUsuarios con perfil sucursalId="${sucursal}": ${olivaresUserIds.size}`);

  await wipeChecador(db, sucursal, olivaresUserIds, dryRun);

  console.log(
    dryRun
      ? '\nDry-run terminado.'
      : '\nListo (Firestore). Limpia IndexedDB en cada navegador/PWA: ver docs/RESET_OLIVARES.md'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
