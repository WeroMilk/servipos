#!/usr/bin/env node
/**
 * Exporta todo Firestore (colecciones raíz y subcolecciones) a JSON.
 * Evita paquetes externos rotos (p. ej. node-firestore-import-export + "Page size must be nonnegative").
 *
 * Requiere GOOGLE_APPLICATION_CREDENTIALS → JSON de cuenta de servicio con permisos de lectura.
 *
 * Uso (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\serviceAccount.json"
 *   node scripts/export-firestore-full.mjs --out=./firestore-backup.json
 *
 * Opciones:
 *   --out=RUTA       Archivo de salida (default: firestore-export.json en cwd)
 *   --project=ID     (default: .firebaserc o FIREBASE_PROJECT_ID)
 *   --pretty         JSON indentado (más grande en disco)
 *   --ndjson         Una línea JSON por documento (menos RAM en proyectos grandes)
 */

import { createWriteStream, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    out: join(process.cwd(), 'firestore-export.json'),
    project: process.env.FIREBASE_PROJECT_ID || readDefaultProjectId(),
    pretty: false,
    ndjson: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--pretty') out.pretty = true;
    else if (a === '--ndjson') out.ndjson = true;
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length).trim();
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length).trim();
  }
  return out;
}

/** Convierte tipos de Firestore a JSON serializable (reimportables con metadatos). */
function serializeValue(v) {
  if (v === null || v === undefined) return null;
  const ts = admin.firestore.Timestamp;
  if (v instanceof ts) {
    return { __fs: 'Timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds, iso: v.toDate().toISOString() };
  }
  if (v instanceof admin.firestore.GeoPoint) {
    return { __fs: 'GeoPoint', latitude: v.latitude, longitude: v.longitude };
  }
  if (v instanceof admin.firestore.DocumentReference) {
    return { __fs: 'DocumentReference', path: v.path };
  }
  if (typeof v === 'object' && v !== null && typeof v.toDate === 'function') {
    const d = v.toDate();
    if (d instanceof Date && !isNaN(d.getTime())) {
      return { __fs: 'Timestamp', iso: d.toISOString() };
    }
  }
  if (Buffer.isBuffer(v)) {
    return { __fs: 'Bytes', base64: v.toString('base64') };
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = serializeValue(val);
    }
    return o;
  }
  return v;
}

async function exportCollectionRecursive(colRef, onDoc) {
  const label = colRef.path || colRef.id;
  process.stderr.write(`Leyendo ${label} …\n`);
  const snap = await colRef.get();
  for (const doc of snap.docs) {
    await onDoc(doc.ref.path, serializeValue(doc.data()));
    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      await exportCollectionRecursive(sub, onDoc);
    }
  }
}

async function main() {
  const { out, project, pretty, ndjson } = parseArgs();

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !existsSync(credPath)) {
    console.error(
      'Falta GOOGLE_APPLICATION_CREDENTIALS apuntando a un JSON de cuenta de servicio (ruta válida).'
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: project,
  });

  const db = admin.firestore();
  const roots = await db.listCollections();

  if (ndjson) {
    const stream = createWriteStream(out, { encoding: 'utf8' });
    let n = 0;
    const writeLine = (line) =>
      new Promise((resolve, reject) => {
        stream.write(line + '\n', (err) => (err ? reject(err) : resolve()));
      });
    const onDoc = async (path, data) => {
      await writeLine(JSON.stringify({ path, data }));
      n++;
    };
    for (const col of roots) {
      await exportCollectionRecursive(col, onDoc);
    }
    await new Promise((resolve, reject) => {
      stream.end((err) => (err ? reject(err) : resolve()));
    });
    process.stderr.write(`\nListo: ${n} documentos → ${out} (NDJSON)\n`);
    return;
  }

  const documents = [];
  const onDoc = async (path, data) => {
    documents.push({ path, data });
  };
  for (const col of roots) {
    await exportCollectionRecursive(col, onDoc);
  }

  const payload = {
    exportVersion: 1,
    projectId: project,
    exportedAt: new Date().toISOString(),
    documentCount: documents.length,
    documents,
  };

  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload), 'utf8');
  process.stderr.write(`\nListo: ${documents.length} documentos → ${out}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
