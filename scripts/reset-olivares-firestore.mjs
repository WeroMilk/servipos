#!/usr/bin/env node
/**
 * Borra datos operativos de una sucursal en Firestore (ventas, movimientos, productos, contador folio).
 * Requiere cuenta de servicio con permisos en el proyecto (IAM: roles/datastore.owner o editor acotado).
 *
 * Uso:
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\serviceAccount.json
 *   node scripts/reset-olivares-firestore.mjs
 *
 * Opciones:
 *   --sucursal=olivares   (default: olivares)
 *   --project=ID          (default: servipartzpos-26417 desde .firebaserc)
 *   --dry-run             solo imprime qué haría
 *
 * IndexedDB (POSMexicoDB) en cada navegador: limpiar manualmente o ver docs/RESET_OLIVARES.md
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

async function deleteInBatches(query, label, dryRun) {
  const db = admin.firestore();
  let total = 0;
  for (;;) {
    const snap = await query.limit(500).get();
    if (snap.empty) break;
    if (dryRun) {
      total += snap.size;
      console.log(`[dry-run] ${label}: borraría ${snap.size} docs (lote; total acumulado ${total})`);
      break;
    }
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    console.log(`  ${label}: +${snap.size} eliminados (total ${total})`);
    if (snap.size < 500) break;
  }
  if (total === 0 && !dryRun) console.log(`  ${label}: (ya vacío)`);
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

  const counterRef = sucRef.collection('counters').doc('ventasDiario');
  const cSnap = await counterRef.get();
  if (cSnap.exists) {
    if (dryRun) console.log('[dry-run] Borraría counters/ventasDiario');
    else {
      await counterRef.delete();
      console.log('Documento counters/ventasDiario eliminado.');
    }
  } else {
    console.log('counters/ventasDiario: no existía.');
  }

  console.log('\nchecadorRegistros con sucursalId == sucursal …');
  const ch = db.collection('checadorRegistros').where('sucursalId', '==', sucursal);
  if (dryRun) {
    const agg = await ch.count().get();
    console.log(`[dry-run] documentos a borrar: ${agg.data().count}`);
  } else {
    await deleteInBatches(ch, 'checadorRegistros', false);
  }

  console.log(dryRun ? '\nDry-run terminado.' : '\nListo. Limpia IndexedDB en cada navegador si usas la PWA (ver docs/RESET_OLIVARES.md).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
