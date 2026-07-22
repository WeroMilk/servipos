import { readFileSync, writeFileSync } from 'node:fs';

const codes = readFileSync('exports/mostrador-skus.txt', 'utf8')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const lit = codes.map((c) => `    '${c.replace(/'/g, "\\'")}',`).join('\n');
writeFileSync('exports/mostrador-snippet.txt', `  Mostrador: [\n${lit}\n  ],\n`);
console.log('codes', codes.length);
