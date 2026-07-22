import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/ubicacionesMuebleA.ts';
let src = readFileSync(path, 'utf8');
const snippet = readFileSync('exports/mostrador-snippet.txt', 'utf8').trimEnd() + '\n';

if (/^\s*Mostrador\s*:/m.test(src)) {
  console.error('Mostrador already in map');
  process.exit(1);
}

const before = src;
src = src.replace(/  H1: \[\],\r?\n\};/, `  H1: [],\r\n${snippet.replace(/\n/g, '\r\n')}};`);
if (src === before) {
  console.error('Failed to insert Mostrador into MUEBLE_POR_SLOT');
  process.exit(1);
}

if (!src.includes("'Mostrador'")) {
  const before2 = src;
  src = src.replace(/  'H1',\r?\n\] as const;/, "  'H1',\r\n  'Mostrador',\r\n] as const;");
  if (src === before2) {
    console.error('Failed to insert Mostrador into SLOT_ORDER');
    process.exit(1);
  }
}

writeFileSync(path, src);
console.log('Mostrador codes inserted');
