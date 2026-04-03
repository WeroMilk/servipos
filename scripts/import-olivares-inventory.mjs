#!/usr/bin/env node
/**
 * Importa catálogo + existencia desde Excel (inventario por categoría) a
 * Firestore: sucursales/{sucursal}/products
 *
 * Requiere GOOGLE_APPLICATION_CREDENTIALS solo si NO usas --dry-run.
 *
 * Uso:
 *   node scripts/import-olivares-inventory.mjs --dir="C:\ruta\carpeta\xlsx" --dry-run
 *   node scripts/import-olivares-inventory.mjs --dir=... --precios="C:\ruta\precios.xlsx"
 *   node scripts/import-olivares-inventory.mjs --dir=... --precios=... --strict-precios
 *
 * Opciones:
 *   --dir=              Carpeta con .xlsx (orden alfabético por nombre de archivo)
 *   --precios=          .xlsx o .csv UTF-8 con columnas SKU y precio (detección automática o --col-sku / --col-precio)
 *   --col-sku=          Nombre exacto de columna SKU en archivo de precios
 *   --col-precio=       Nombre exacto de columna precio venta
 *   --col-precio-compra= Nombre exacto de columna precio compra (opcional)
 *   --sucursal=olivares
 *   --project=ID
 *   --dry-run
 *   --strict-precios    Abortar si algún producto queda sin precio del archivo
 *   --ultimo-gana       Si el mismo SKU aparece en varios Excel, usar la última fila
 *   --incluir-ref-id    Añadir "Ref: {ID}" al inicio de descripcion
 *   --sample=15         En dry-run, cuántas filas de muestra imprimir por archivo
 *
 * Catálogo abril 2026 (Olivares) en el repo: data/inventario-abril-2026-olivares/*.xlsx
 *   npm run import:olivares-inventory:abril2026:dry
 *   (o: npm run import:olivares-inventory:abril2026 -- --dry-run)
 *   set GOOGLE_APPLICATION_CREDENTIALS=ruta\serviceAccount.json
 *   npm run import:olivares-inventory:abril2026
 * El script crea documentos nuevos (no fusiona por SKU). Si la sucursal ya tiene productos,
 * ejecute antes reset-olivares-firestore.mjs o tendrá duplicados.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import admin from 'firebase-admin';
import XLSX from 'xlsx';

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
    dir: '',
    precios: '',
    colSku: '',
    colPrecio: '',
    colPrecioCompra: '',
    sucursal: 'olivares',
    project: process.env.FIREBASE_PROJECT_ID || readDefaultProjectId(),
    dryRun: false,
    strictPrecios: false,
    ultimoGana: false,
    incluirRefId: false,
    sample: 15,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--strict-precios') out.strictPrecios = true;
    else if (a === '--ultimo-gana') out.ultimoGana = true;
    else if (a === '--incluir-ref-id') out.incluirRefId = true;
    else if (a.startsWith('--dir=')) out.dir = a.slice('--dir='.length).trim();
    else if (a.startsWith('--precios=')) out.precios = a.slice('--precios='.length).trim();
    else if (a.startsWith('--col-sku=')) out.colSku = a.slice('--col-sku='.length).trim();
    else if (a.startsWith('--col-precio=')) out.colPrecio = a.slice('--col-precio='.length).trim();
    else if (a.startsWith('--col-precio-compra=')) out.colPrecioCompra = a.slice('--col-precio-compra='.length).trim();
    else if (a.startsWith('--sucursal=')) out.sucursal = a.slice('--sucursal='.length).trim();
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length).trim();
    else if (a.startsWith('--sample=')) out.sample = Math.max(0, Number(a.slice('--sample='.length)) || 0);
  }
  return out;
}

/** Sin acentos, minúsculas, para comparar encabezados. */
function normHeader(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cellStr(v) {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function normSkuBarcode(s) {
  return cellStr(s)
    .toLocaleUpperCase('es-MX')
    .trim();
}

function normalizeProductNombreKey(nombre) {
  return nombre
    .toLocaleUpperCase('es-MX')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Mapea fila {headerOriginal: value} a campos por normHeader del key. */
function rowByNormHeaders(row) {
  const m = new Map();
  for (const [k, v] of Object.entries(row)) {
    m.set(normHeader(k), { key: k, value: v });
  }
  return m;
}

function pickByAliases(normMap, aliases) {
  for (const a of aliases) {
    const na = normHeader(a);
    if (normMap.has(na)) return normMap.get(na);
  }
  return null;
}

const INVENTORY_ALIASES = {
  id: ['id'],
  codigo: ['codigo', 'código', 'sku', 'clave'],
  descripcion: ['descripcion', 'descripción', 'nombre', 'producto'],
  cantidad: ['cantidad'],
  actual: ['actual', 'existencia', 'stock'],
  justificacion: ['justificacion', 'justificación', 'nota'],
};

function parseInventoryWorkbook(filePath, categoria) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const out = [];
  const skipped = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nm = rowByNormHeaders(row);
    const cod = pickByAliases(nm, INVENTORY_ALIASES.codigo);
    const desc = pickByAliases(nm, INVENTORY_ALIASES.descripcion);
    const act = pickByAliases(nm, INVENTORY_ALIASES.actual);
    const idCell = pickByAliases(nm, INVENTORY_ALIASES.id);
    const just = pickByAliases(nm, INVENTORY_ALIASES.justificacion);

    const skuRaw = cod ? cellStr(cod.value) : '';
    const nombreRaw = desc ? cellStr(desc.value) : '';
    const sku = normSkuBarcode(skuRaw);
    const nombre = normalizeProductNombreKey(nombreRaw);

    if (!sku || !nombre) {
      skipped.push({ file: basename(filePath), row: i + 2, reason: !sku ? 'sin codigo' : 'sin descripcion' });
      continue;
    }
    const headerLike = new Set(['CODIGO', 'CÓDIGO', 'ID', 'SKU', 'DESCRIPCION', 'DESCRIPCIÓN', 'CLAVE']);
    if (headerLike.has(sku) || (nombre.length < 40 && headerLike.has(nombre))) {
      skipped.push({ file: basename(filePath), row: i + 2, reason: 'fila encabezado o titulo' });
      continue;
    }

    const existencia = parseNumber(act?.value ?? 0);
    const idRef = idCell ? cellStr(idCell.value) : '';
    const justTxt = just ? cellStr(just.value) : '';

    out.push({
      sourceFile: basename(filePath),
      rowIndex: i + 2,
      categoria,
      sku,
      nombre,
      existencia,
      idRef,
      justTxt,
    });
  }
  return { rows: out, skipped };
}

function listInventoryXlsx(dir) {
  const names = readdirSync(dir)
    .filter((n) => extname(n).toLowerCase() === '.xlsx')
    .filter((n) => !n.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b, 'es'));
  return names.map((n) => join(dir, n));
}

function loadWorkbookRows(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.csv') {
    const buf = readFileSync(filePath);
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

const SKU_PRICE_ALIASES = ['codigo', 'código', 'sku', 'clave', 'clave producto', 'claveproducto'];
const PRECIO_VENTA_ALIASES = [
  'precio venta',
  'precioventa',
  'precio_venta',
  'precio',
  'p. venta',
  'pventa',
  'pv',
  'precio publico',
  'preciopublico',
];
const PRECIO_COMPRA_ALIASES = [
  'precio compra',
  'preciocompra',
  'precio_compra',
  'costo',
  'precio proveedor',
];

function detectPriceColumns(rows, colSku, colPrecio, colPrecioCompra) {
  if (rows.length === 0) return { skuCol: null, precioCol: null, compraCol: null };
  const first = rows[0];
  const keys = Object.keys(first);
  const normKeys = keys.map((k) => ({ orig: k, n: normHeader(k) }));

  let skuCol = colSku || null;
  let precioCol = colPrecio || null;
  let compraCol = colPrecioCompra || null;

  if (!skuCol) {
    for (const alias of SKU_PRICE_ALIASES) {
      const na = normHeader(alias);
      const hit = normKeys.find((x) => x.n === na);
      if (hit) {
        skuCol = hit.orig;
        break;
      }
    }
    if (!skuCol) {
      const hit = normKeys.find((x) => SKU_PRICE_ALIASES.some((a) => x.n.includes(normHeader(a))));
      if (hit) skuCol = hit.orig;
    }
    if (!skuCol) {
      const hit = normKeys.find((x) => {
        const o = String(x.orig).trim().toLowerCase();
        return o === 'sku' || o === 'clave' || (o.includes('digo') && /^c/.test(o));
      });
      if (hit) skuCol = hit.orig;
    }
  }

  if (!precioCol) {
    for (const alias of PRECIO_VENTA_ALIASES) {
      const na = normHeader(alias);
      const hit = normKeys.find((x) => x.n === na);
      if (hit) {
        precioCol = hit.orig;
        break;
      }
    }
    if (!precioCol) {
      const hit = normKeys.find((x) =>
        PRECIO_VENTA_ALIASES.some((a) => {
          const na = normHeader(a);
          return x.n.includes('precio') && (x.n.includes('venta') || na === 'precio');
        })
      );
      if (hit) precioCol = hit.orig;
    }
    if (!precioCol) {
      const hit = normKeys.find((x) => {
        const o = String(x.orig).trim().toLowerCase();
        return o.includes('precio') && o.includes('venta');
      });
      if (hit) precioCol = hit.orig;
    }
    if (!precioCol) {
      const hit = normKeys.find((x) => normHeader(x.orig) === 'precio');
      if (hit) precioCol = hit.orig;
    }
  }

  if (!compraCol) {
    for (const alias of PRECIO_COMPRA_ALIASES) {
      const na = normHeader(alias);
      const hit = normKeys.find((x) => x.n === na);
      if (hit) {
        compraCol = hit.orig;
        break;
      }
    }
  }

  return { skuCol, precioCol, compraCol };
}

function buildPriceMap(filePath, colSku, colPrecio, colPrecioCompra) {
  const rows = loadWorkbookRows(filePath);
  const { skuCol, precioCol, compraCol } = detectPriceColumns(rows, colSku, colPrecio, colPrecioCompra);
  if (!skuCol || !precioCol) {
    throw new Error(
      `No se detectaron columnas de precios. Encabezados: ${rows[0] ? Object.keys(rows[0]).join(', ') : '(vacío)'}. Use --col-sku= y --col-precio=.`
    );
  }
  const map = new Map();
  for (const row of rows) {
    const sku = normSkuBarcode(row[skuCol]);
    if (!sku) continue;
    const pv = parseNumber(row[precioCol]);
    const pc = compraCol ? parseNumber(row[compraCol]) : undefined;
    const prev = map.get(sku);
    const entry = { precioVenta: pv, precioCompra: pc != null && pc > 0 ? pc : undefined };
    if (prev && (prev.precioVenta !== entry.precioVenta || prev.precioCompra !== entry.precioCompra)) {
      entry._dup = true;
    }
    map.set(sku, entry);
  }
  return { map, skuCol, precioCol, compraCol };
}

function mergeRowsFromDir(dir, ultimoGana) {
  const files = listInventoryXlsx(dir);
  if (files.length === 0) throw new Error(`No hay archivos .xlsx en: ${dir}`);

  const bySku = new Map();
  const duplicateSkus = [];
  const perFile = [];
  const allSkipped = [];

  for (const fp of files) {
    const cat = basename(fp, '.xlsx');
    const { rows, skipped } = parseInventoryWorkbook(fp, cat);
    allSkipped.push(...skipped);
    perFile.push({ file: basename(fp), count: rows.length, skipped: skipped.length });
    for (const r of rows) {
      if (!bySku.has(r.sku)) {
        bySku.set(r.sku, r);
      } else {
        duplicateSkus.push({ sku: r.sku, first: bySku.get(r.sku).sourceFile, second: r.sourceFile });
        if (ultimoGana) bySku.set(r.sku, r);
      }
    }
  }

  return { bySku, duplicateSkus, perFile, allSkipped, files };
}

function disambiguateNombres(rows) {
  const byName = new Map();
  for (const r of rows) {
    const k = normalizeProductNombreKey(r.nombre);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  for (const [, list] of byName) {
    if (list.length <= 1) continue;
    for (const r of list) {
      r.nombre = `${r.nombre} (${r.sku})`;
    }
  }
}

function buildDescripcion(r, incluirRefId) {
  const parts = [];
  if (incluirRefId && r.idRef) parts.push(`Ref: ${r.idRef}`);
  if (r.justTxt) parts.push(r.justTxt);
  if (parts.length === 0) return null;
  return parts.join(' | ');
}

function firestoreProductPayload(r, precioVenta, precioCompra, incluirRefId) {
  const unidadMedida = r.categoria === 'SERVICIOS' ? 'E48' : 'H87';
  const descripcion = buildDescripcion(r, incluirRefId);
  return {
    sku: r.sku,
    codigoBarras: null,
    nombre: r.nombre,
    descripcion,
    precioVenta,
    precioCompra: precioCompra != null && precioCompra > 0 ? precioCompra : null,
    impuesto: 16,
    existencia: r.existencia,
    existenciaMinima: 0,
    categoria: r.categoria,
    proveedor: null,
    preciosPorListaCliente: null,
    imagen: null,
    unidadMedida,
    claveProdServ: null,
    activo: true,
  };
}

async function commitProducts(db, sucursalId, rows, priceMap, opts) {
  const { incluirRefId, strictPrecios, preciosPath } = opts;
  const missingPrice = [];
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const col = db.collection('sucursales').doc(sucursalId).collection('products');

  for (const r of rows) {
    if (strictPrecios && preciosPath && !priceMap?.get(r.sku)) {
      missingPrice.push(r.sku);
    }
  }

  const uniqueMissing = [...new Set(missingPrice)];
  if (strictPrecios && uniqueMissing.length > 0) {
    throw new Error(
      `--strict-precios: ${uniqueMissing.length} SKU(s) sin fila en archivo de precios (ej. ${uniqueMissing.slice(0, 8).join(', ')}).`
    );
  }

  let batch = db.batch();
  let n = 0;
  let total = 0;
  for (const r of rows) {
    let pv = 0;
    let pc;
    if (priceMap && priceMap.size) {
      const pe = priceMap.get(r.sku);
      if (pe) {
        pv = pe.precioVenta;
        pc = pe.precioCompra;
      }
    }
    const payload = firestoreProductPayload(r, pv, pc, incluirRefId);
    const ref = col.doc();
    batch.set(ref, { ...payload, createdAt: ts, updatedAt: ts });
    n++;
    total++;
    if (n >= 500) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return { written: total, missingPriceSkus: uniqueMissing };
}

async function main() {
  const args = parseArgs();
  if (!args.dir) {
    console.error('Falta --dir=ruta a la carpeta con los .xlsx de inventario.');
    process.exit(1);
  }
  if (!existsSync(args.dir)) {
    console.error(`No existe la carpeta: ${args.dir}`);
    process.exit(1);
  }

  const { bySku, duplicateSkus, perFile, allSkipped, files } = mergeRowsFromDir(args.dir, args.ultimoGana);

  if (duplicateSkus.length > 0 && !args.ultimoGana) {
    console.error('\nSKU duplicado(s) entre archivos (use --ultimo-gana para quedarse con la última fila):');
    for (const d of duplicateSkus.slice(0, 30)) {
      console.error(`  ${d.sku}: ${d.first} vs ${d.second}`);
    }
    if (duplicateSkus.length > 30) console.error(`  … y ${duplicateSkus.length - 30} más`);
    process.exit(1);
  }

  const rows = Array.from(bySku.values());
  disambiguateNombres(rows);

  let priceMap = new Map();
  let priceMeta = { skuCol: '', precioCol: '', compraCol: '' };
  if (args.precios) {
    if (!existsSync(args.precios)) {
      console.error(`No existe el archivo de precios: ${args.precios}`);
      process.exit(1);
    }
    const built = buildPriceMap(args.precios, args.colSku || null, args.colPrecio || null, args.colPrecioCompra || null);
    priceMap = built.map;
    priceMeta = { skuCol: built.skuCol, precioCol: built.precioCol, compraCol: built.compraCol || '' };
  } else if (args.strictPrecios) {
    console.error('--strict-precios requiere --precios=ruta.');
    process.exit(1);
  }

  const skusSinPrecio = [];
  if (args.precios) {
    for (const r of rows) {
      if (!priceMap.has(r.sku)) skusSinPrecio.push(r.sku);
    }
  }

  console.log(`Proyecto: ${args.project}`);
  console.log(`Sucursal: ${args.sucursal}`);
  console.log(`Archivos .xlsx: ${files.length}`);
  if (args.precios) {
    console.log(
      `Precios: ${args.precios} → columnas SKU="${priceMeta.skuCol}", precio="${priceMeta.precioCol}"` +
        (priceMeta.compraCol ? `, compra="${priceMeta.compraCol}"` : '')
    );
  }
  console.log(`Productos únicos (por SKU): ${rows.length}`);
  if (allSkipped.length) console.log(`Filas omitidas: ${allSkipped.length}`);
  if (skusSinPrecio.length) console.log(`SKUs sin precio en archivo: ${skusSinPrecio.length}`);

  if (args.dryRun) {
    console.log('\n--- Por archivo ---');
    for (const p of perFile) {
      console.log(`  ${p.file}: ${p.count} productos, ${p.skipped} filas omitidas`);
    }
    if (allSkipped.length) {
      console.log('\n--- Muestra filas omitidas (hasta 20) ---');
      for (const s of allSkipped.slice(0, 20)) {
        console.log(`  ${s.file} fila ${s.row}: ${s.reason}`);
      }
    }
    if (skusSinPrecio.length) {
      console.log('\n--- Muestra SKUs sin precio (hasta 25) ---');
      console.log(skusSinPrecio.slice(0, 25).join(', '));
    }
    console.log('\n--- Muestra normalizada (primeros archivos) ---');
    const byFile = new Map();
    for (const r of rows) {
      if (!byFile.has(r.sourceFile)) byFile.set(r.sourceFile, []);
      byFile.get(r.sourceFile).push(r);
    }
    let shown = 0;
    for (const name of [...byFile.keys()].sort((a, b) => a.localeCompare(b, 'es'))) {
      const list = byFile.get(name);
      const lim = Math.min(args.sample, list.length);
      console.log(`\n[${name}] (${list.length} líneas)`);
      for (let i = 0; i < lim; i++) {
        const r = list[i];
        const pe = priceMap.get(r.sku);
        const pv = pe ? pe.precioVenta : 0;
        console.log(
          `  ${r.sku} | ex=${r.existencia} | $${pv} | ${r.nombre.slice(0, 60)}${r.nombre.length > 60 ? '…' : ''}`
        );
      }
      shown++;
      if (shown >= 8) {
        console.log('\n… (limitado a 8 archivos en muestra; use --sample=N)');
        break;
      }
    }
    console.log('\nDry-run OK. Sin escritura en Firestore.');
    return;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath?.trim()) {
    console.error('Falta la variable de entorno GOOGLE_APPLICATION_CREDENTIALS.');
    console.error('Ejemplo (PowerShell):');
    console.error('  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\Users\\tuUsuario\\Downloads\\proyecto-firebase-adminsdk-xxxxx.json"');
    console.error('Descarga el JSON en Firebase → Project settings → Service accounts → Generate new private key.');
    process.exit(1);
  }
  if (!existsSync(credPath)) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS no apunta a un archivo que exista en disco:');
    console.error(`  ${credPath}`);
    console.error('Comprueba con: Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS   (debe ser True)');
    console.error(
      'No uses rutas de ejemplo como "ruta\\real\\al-archivo.json"; pon la ruta real al JSON de la cuenta de servicio.'
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: args.project,
  });
  const db = admin.firestore();

  const { written, missingPriceSkus } = await commitProducts(db, args.sucursal, rows, priceMap, {
    incluirRefId: args.incluirRefId,
    strictPrecios: args.strictPrecios,
    preciosPath: args.precios,
  });

  console.log(`\nListo: ${written} producto(s) creados en sucursales/${args.sucursal}/products`);
  if (missingPriceSkus.length && !args.strictPrecios && args.precios) {
    console.log(`Advertencia: ${missingPriceSkus.length} SKU(s) sin fila en precios → precioVenta 0`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
