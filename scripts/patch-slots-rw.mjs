/**
 * Inserta slots R1…W4 en ubicacionesMuebleA.ts desde exports/nuevos-slots-rw.txt
 */
import { readFileSync, writeFileSync } from 'node:fs';

function parseSlots(raw) {
  /** @type {Record<string, string[]>} */
  const out = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^[A-ZÑ][A-ZÑ0-9]*:$/i.test(t) || t === 'BANDAS:') {
      current = t.slice(0, -1);
      if (!out[current]) out[current] = [];
      continue;
    }
    if (!current) continue;
    out[current].push(t);
  }
  return out;
}

function slotLiteral(name, codes) {
  if (!codes.length) return `  ${name}: [],\n`;
  const body = codes.map((c) => `    '${c.replace(/'/g, "\\'")}',`).join('\n');
  return `  ${name}: [\n${body}\n  ],\n`;
}

const ORDER = [
  'R1',
  'S1',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'U',
  'U1',
  'U2',
  'U3',
  'U4',
  'U5',
  'U6',
  'V1',
  'V2',
  'V3',
  'V4',
  'W1',
  'W2',
  'W3',
  'W4',
];

const slots = parseSlots(readFileSync('exports/nuevos-slots-rw.txt', 'utf8'));
for (const k of ORDER) {
  if (!(k in slots)) slots[k] = [];
}

const path = 'src/data/ubicacionesMuebleA.ts';
let src = readFileSync(path, 'utf8');

if (src.includes('\n  R1:') || src.includes("\n  'R1'")) {
  console.error('R1 ya está; abortando.');
  process.exit(1);
}

const block = ORDER.map((k) => slotLiteral(k, slots[k])).join('');

// Insertar antes de BANDAS (o Mostrador)
if (src.includes('\n  BANDAS:')) {
  src = src.replace('\n  BANDAS:', `\n${block}  BANDAS:`);
} else if (src.includes('\n  Mostrador:')) {
  src = src.replace('\n  Mostrador:', `\n${block}  Mostrador:`);
} else {
  console.error('No encontré ancla BANDAS/Mostrador');
  process.exit(1);
}

const orderLines = ORDER.map((k) => `  '${k}',`).join('\n');
if (src.includes("\n  'BANDAS',")) {
  src = src.replace("\n  'BANDAS',", `\n${orderLines}\n  'BANDAS',`);
} else if (src.includes("\n  'Mostrador',")) {
  src = src.replace("\n  'Mostrador',", `\n${orderLines}\n  'Mostrador',`);
} else {
  console.error('No encontré ancla en SLOT_ORDER');
  process.exit(1);
}

writeFileSync(path, src);

const total = ORDER.reduce((n, k) => n + slots[k].length, 0);
console.log(`OK: ${ORDER.length} slots, ${total} códigos`);
for (const k of ORDER) console.log(`  ${k}: ${slots[k].length}`);
