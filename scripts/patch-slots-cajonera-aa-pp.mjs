import fs from 'node:fs';

const path = 'src/data/ubicacionesMuebleA.ts';
let src = fs.readFileSync(path, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
src = src.replace(/\r\n/g, '\n');

/** Lista del usuario: cajonera + AA…PP / ÑÑ. GG32068 → GG3 + 2068. */
const data = {
  Cajonera: [
    '315',
    '134',
    '101',
    '102',
    '1459',
    '817',
    '217',
    '106',
    '1418',
    '868',
    'WR01F01914',
    '279769',
    '1383',
    '634',
    '393',
    '383727',
    '261',
    'W910010096',
    '7503033971659',
    '63341',
    '79',
    '78',
    '8546462',
    '208',
    '232',
    '1890',
    '1548',
    '1661',
    '8318084',
    '204',
    '520',
    '1407',
    '1762',
  ],
  AA1: ['2301', '2301', '2301'],
  AA2: ['91', '933', '1296', '60116'],
  AA3: [],
  BB1: ['7503026414866'],
  BB2: ['037103570192', '503'],
  BB3: [],
  CC: ['830', '970', '891', '849', '853', '852', '848'],
  CC1: ['253'],
  CC2: ['1194', '1194', '1194', '1194'],
  DD: [
    '969',
    '968',
    '967',
    '966',
    '7503026196847',
    '1062',
    '1062',
    '218',
    '154',
    '153',
    '138',
    '1917',
    '185',
    '186',
  ],
  DD1: ['851', '850'],
  DD2: ['7503026178836'],
  DD3: [],
  DD4: [],
  EE: [
    '2244',
    '2245',
    '877',
    '877',
    '876',
    '316',
    '36',
    '37',
    '38',
    '39',
    '1390',
    '854',
    '31',
    '35',
    '34',
  ],
  EE1: ['105g5914'],
  EE2: [],
  EE3: ['950'],
  FF1: [],
  GG: [],
  GG1: ['2056'],
  GG2: ['2063', '2062'],
  GG3: ['2068'],
  GG4: [],
  HH: [],
  HH1: [],
  HH2: ['855', '507', '937'],
  HH3: [],
  HH4: [],
  II1: [],
  JJ: [],
  JJ1: [],
  JJ2: [],
  KK1: [],
  LL1: [],
  LL2: [],
  LL3: [],
  MM1: ['295', '299', '788'],
  MM2: [],
  NN: [],
  NN1: [],
  NN2: [],
  NN3: ['1306', '1308', '1424', '1307', '28', '1305'],
  NN4: ['1293', '1805'],
  NN5: [],
  NN6: [],
  ÑÑ: [],
  ÑÑ1: ['1583', '1583', '1583', '1583', '1583', '1583'],
  ÑÑ2: ['7503026192535', '7503026192535', '2107'],
  ÑÑ3: ['2032', '7503026195734', '7503026414521'],
  ÑÑ4: [],
  ÑÑ5: ['1720', '1720', '1711'],
  ÑÑ6: ['2033', '2033'],
  OO: [],
  OO1: ['7503033971369'],
  OO2: ['526', '1671', '1672'],
  OO3: ['227', '7503003799214', '229'],
  OO4: [],
  OO5: [],
  PP: [],
  PP1: [],
  PP2: [],
  PP3: ['6620132288042', '2202'],
  PP4: [],
  PP5: [],
  PP6: [],
};

function fmtSlot(name, codes) {
  const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
  if (codes.length === 0) return `  ${key}: [],`;
  const body = codes.map((c) => `    '${c.replace(/'/g, "\\'")}',`).join('\n');
  return `  ${key}: [\n${body}\n  ],`;
}

const block = Object.entries(data)
  .map(([k, v]) => fmtSlot(k, v))
  .join('\n');

if (!src.includes('Z10: [],\n  BANDAS:')) {
  throw new Error('Z10/BANDAS anchor missing');
}
if (src.includes('Cajonera:') || src.includes('\n  AA1:')) {
  throw new Error('Already patched');
}

src = src.replace('Z10: [],\n  BANDAS:', `Z10: [],\n${block}\n  BANDAS:`);

const orderInsert = Object.keys(data)
  .map((s) => `  '${s.replace(/'/g, "\\'")}',`)
  .join('\n');

if (!src.includes("  'Z10',\n  'BANDAS',")) {
  throw new Error('SLOT_ORDER anchor missing');
}
src = src.replace("  'Z10',\n  'BANDAS',", `  'Z10',\n${orderInsert}\n  'BANDAS',`);

const oldLetrasReturn = "return ['Mostrador', 'BANDAS', ...singles, ...doubles];";
const newLetrasBlock = `export const MUEBLE_LETRAS: readonly string[] = (() => {
  const singles = [
    ...Array.from({ length: 14 }, (_, i) => String.fromCharCode(65 + i)), // A–N
    'Ñ',
    ...Array.from({ length: 12 }, (_, i) => String.fromCharCode(79 + i)), // O–Z
  ];
  // AA…NN, ÑÑ, OO…PP (croquis muro / islas dobles)
  const doubles = [
    ...Array.from({ length: 14 }, (_, i) => {
      const ch = String.fromCharCode(65 + i); // A…N
      return \`\${ch}\${ch}\`;
    }),
    'ÑÑ',
    ...Array.from({ length: 2 }, (_, i) => {
      const ch = String.fromCharCode(79 + i); // O…P
      return \`\${ch}\${ch}\`;
    }),
  ];
  return ['Mostrador', 'BANDAS', 'Cajonera', ...singles, ...doubles];
})();`;

const letrasRe =
  /export const MUEBLE_LETRAS: readonly string\[\] = \(\(\) => \{[\s\S]*?\}\)\(\);/;
if (!letrasRe.test(src)) {
  throw new Error('MUEBLE_LETRAS block missing');
}
if (!src.includes(oldLetrasReturn)) {
  throw new Error('MUEBLE_LETRAS return line missing');
}
src = src.replace(letrasRe, newLetrasBlock);

src = src.replace(
  '/** Códigos por slot de ubicación física (muebles A–H + Mostrador). */',
  '/** Códigos por slot de ubicación física (muebles A–Z, AA–PP, Cajonera, BANDAS, Mostrador). */'
);

fs.writeFileSync(path, nl === '\r\n' ? src.replace(/\n/g, '\r\n') : src);

console.log('patched slots:', Object.keys(data).length);
console.log('file has AA1:', src.includes('AA1:'));
console.log('file has Cajonera:', src.includes('Cajonera:'));
console.log('file has ÑÑ1:', src.includes("'ÑÑ1'"));
console.log('MUEBLE_LETRAS Cajonera:', src.includes("'Cajonera'"));
console.log('SLOT_ORDER AA1:', src.includes("  'AA1',"));
console.log('GG3 2068:', /GG3:\s*\[[\s\S]*?'2068'/.test(src));
