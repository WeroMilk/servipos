/**
 * Inserta slots I…Q / Ñ / BANDAS en ubicacionesMuebleA.ts desde exports/nuevos-slots-ubicaciones.txt
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

const slots = parseSlots(readFileSync('exports/nuevos-slots-ubicaciones.txt', 'utf8'));

// Orden explícito solicitado
const ORDER = [
  'I',
  'I1',
  'I2',
  'J1',
  'J2',
  'J3',
  'J4',
  'K1',
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'N1',
  'Ñ1',
  'Ñ2',
  'Ñ3',
  'Ñ4',
  'Ñ5',
  'O1',
  'O2',
  'O3',
  'O4',
  'O5',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'BANDAS',
];

for (const k of ORDER) {
  if (!(k in slots)) slots[k] = [];
}

const path = 'src/data/ubicacionesMuebleA.ts';
let src = readFileSync(path, 'utf8');

if (src.includes('\n  BANDAS:') || src.includes("\n  'BANDAS'")) {
  console.error('BANDAS ya está en el archivo; abortando para no duplicar.');
  process.exit(1);
}

const block = ORDER.map((k) => slotLiteral(k, slots[k])).join('');

// Insertar antes de Mostrador en el objeto (si existe) o antes del cierre tras H1
if (src.includes('\n  Mostrador:')) {
  src = src.replace('\n  Mostrador:', `\n${block}  Mostrador:`);
} else {
  src = src.replace(/\n  H1: \[\],\r?\n/, `\n  H1: [],\n${block}`);
}

const orderLines = ORDER.map((k) => `  '${k}',`).join('\n');
if (src.includes("\n  'Mostrador',")) {
  src = src.replace("\n  'Mostrador',", `\n${orderLines}\n  'Mostrador',`);
} else {
  src = src.replace(/\n  'H1',\r?\n\] as const;/, `\n  'H1',\n${orderLines}\n] as const;`);
}

// MUEBLE_LETRAS: Mostrador, BANDAS, A–Z con Ñ entre N y O, AA…PP
src = src.replace(
  /export const MUEBLE_LETRAS: readonly string\[\] = \(\(\) => \{[\s\S]*?\}\)\(\);/,
  `export const MUEBLE_LETRAS: readonly string[] = (() => {
  const singles = [
    ...Array.from({ length: 14 }, (_, i) => String.fromCharCode(65 + i)), // A–N
    'Ñ',
    ...Array.from({ length: 12 }, (_, i) => String.fromCharCode(79 + i)), // O–Z
  ];
  const doubles = Array.from({ length: 16 }, (_, i) => {
    const ch = String.fromCharCode(65 + i); // A…P
    return \`\${ch}\${ch}\`;
  });
  return ['Mostrador', 'BANDAS', ...singles, ...doubles];
})();`
);

src = src.replace(
  '/** Letras/slots de mueble para conteo: Mostrador, A–Z y AA, BB, … PP. */',
  '/** Letras/slots de mueble para conteo: Mostrador, BANDAS, A–Ñ–Z y AA…PP. */'
);

writeFileSync(path, src);

const total = ORDER.reduce((n, k) => n + slots[k].length, 0);
console.log(`OK: ${ORDER.length} slots, ${total} códigos`);
for (const k of ORDER) {
  console.log(`  ${k}: ${slots[k].length}`);
}
