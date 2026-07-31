#!/usr/bin/env node
/**
 * Genera un Word con productos mal ubicados en muebles A–PP (sin Mostrador/BANDAS/Cajonera).
 *
 * Uso:
 *   node scripts/gen-reubicacion-muebles-docx.mjs
 *
 * Fuentes:
 *   - src/data/ubicacionesMuebleA.ts (MUEBLE_POR_SLOT)
 *   - exports/productos-catalogo.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Letras simples A–Z (sin X en croquis) + dobles AA…PP / ÑÑ / ZZ. */
const LETTERS_SINGLES = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'Ñ',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'Y',
  'Z',
];

const LETTERS_DOUBLES = [
  'AA',
  'BB',
  'CC',
  'DD',
  'EE',
  'FF',
  'GG',
  'HH',
  'II',
  'JJ',
  'KK',
  'LL',
  'MM',
  'NN',
  'ÑÑ',
  'OO',
  'PP',
  'ZZ',
];

const LETTERS_APP = [...LETTERS_SINGLES, ...LETTERS_DOUBLES];

/** A–N lavadoras */
const ZONA_LAVADORAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
/** Ñ–Q secadoras */
const ZONA_SECADORAS = ['Ñ', 'O', 'P', 'Q'];
/** R–W refrigeradores */
const ZONA_REFRIGERADORES = ['R', 'S', 'T', 'U', 'V', 'W'];
/**
 * “X–EE” refrigeración general (en croquis no hay X: Y, Z, ZZ, AA–EE).
 * EE es frontera compartida con boiler/licuadoras.
 */
const ZONA_REFRIGERACION_GENERAL = ['Y', 'Z', 'ZZ', 'AA', 'BB', 'CC', 'DD', 'EE'];
/** EE–II boiler y licuadoras (EE e II compartidos con zonas vecinas). */
const ZONA_BOILER_LICUADORAS = ['EE', 'FF', 'GG', 'HH', 'II'];
/** II–PP miscelánea / sin estante propio (II compartido). */
const ZONA_MISCELANEA = ['II', 'JJ', 'KK', 'LL', 'MM', 'NN', 'ÑÑ', 'OO', 'PP'];

/**
 * Acomodo físico según escaneo / plan de piso:
 *   A–N     Lavadoras
 *   Ñ–Q     Secadoras
 *   R–W     Refrigeradores
 *   Y–EE    Refrigeración general (aires, coolers, vitrinas…)
 *   EE–II   Boiler y licuadoras
 *   II–PP   Miscelánea (accesorios, estufas, gases, etc.)
 */
const ZONA_POR_CATEGORIA = {
  LAVADORAS: ZONA_LAVADORAS,
  'LAVADO Y SECADO': ZONA_LAVADORAS,
  SECADORAS: ZONA_SECADORAS,
  SECADORA: ZONA_SECADORAS,
  REFRIGERACION: ZONA_REFRIGERADORES,
  REFRIGERACIÓN: ZONA_REFRIGERADORES,
  'AIRE ACONDICIONADO': ZONA_REFRIGERACION_GENERAL,
  AIRE: ZONA_REFRIGERACION_GENERAL,
  COOLER: ZONA_REFRIGERACION_GENERAL,
  VITRINAS: ZONA_REFRIGERACION_GENERAL,
  BOILER: ZONA_BOILER_LICUADORAS,
  LICUADORAS: ZONA_BOILER_LICUADORAS,
  // Miscelánea / sin estante propio
  ACCESORIOS: ZONA_MISCELANEA,
  ESTUFAS: ZONA_MISCELANEA,
  GASES: ZONA_MISCELANEA,
  ABANICOS: ZONA_MISCELANEA,
  'OLLAS DE PRESION': ZONA_MISCELANEA,
  'OLLAS DE PRESIÓN': ZONA_MISCELANEA,
  'FILTROS Y ACCESORIOS': ZONA_MISCELANEA,
  GENERAL: ZONA_MISCELANEA,
  OTROS: ZONA_MISCELANEA,
};

/** Ya no hay pendientes forzados: boiler/licuadoras/estufas tienen zona. */
const CATEGORIAS_PENDIENTES = new Set([]);

const ZONAS_RESUMEN = [
  ['LAVADORAS', 'A–N'],
  ['SECADORAS', 'Ñ–Q'],
  ['REFRIGERADORES', 'R–W'],
  ['REFRIGERACIÓN GENERAL (aires, coolers, vitrinas)', 'Y–Z / ZZ / AA–EE'],
  ['BOILER Y LICUADORAS', 'EE–II'],
  ['MISCELÁNEA (accesorios, estufas, gases, etc.)', 'II–PP'],
  ['Nota', 'EE e II son fronteras compartidas. No hay letra X en el croquis (se usa Y/Z/ZZ).'],
];

function normSkuBarcode(s) {
  return String(s ?? '')
    .trim()
    .toLocaleUpperCase('es');
}

function normCategoria(c) {
  return String(c ?? '')
    .trim()
    .toLocaleUpperCase('es');
}

function letterOfSlot(slot) {
  const s = String(slot ?? '').trim();
  if (!s) return '';
  const m = s.match(/^([A-Za-zÑñ]+)/u);
  return m ? m[1].toLocaleUpperCase('es') : '';
}

function isSlotAPP(slot) {
  const L = letterOfSlot(slot);
  return LETTERS_APP.includes(L);
}

function parseMueblePorSlot(tsPath) {
  const ts = readFileSync(tsPath, 'utf8');
  const m = ts.match(/export const MUEBLE_POR_SLOT[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('No se pudo parsear MUEBLE_POR_SLOT');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]})`)();
}

function loadCatalog(jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const byCode = new Map();
  for (const p of data.products ?? []) {
    const sku = normSkuBarcode(p.sku);
    if (sku && !byCode.has(sku)) byCode.set(sku, p);
    const bar = normSkuBarcode(p.codigoBarras);
    if (bar && !byCode.has(bar)) byCode.set(bar, p);
  }
  return { raw: data, byCode };
}

function zonaForCategoria(cat) {
  const key = normCategoria(cat);
  return ZONA_POR_CATEGORIA[key] ?? null;
}

function slotsForLetters(allSlots, letters) {
  const set = new Set(letters);
  return allSlots.filter((slot) => set.has(letterOfSlot(slot)));
}

/**
 * Elige destino: prioridad letras de zona → slots con misma categoría → menos carga → vacío.
 * Simula carga al ir asignando.
 */
function assignDestinations(misplaced, slotLoad, slotCatCount, zoneSlotsOrdered) {
  const load = { ...slotLoad };
  const catCount = {};
  for (const [slot, cats] of Object.entries(slotCatCount)) {
    catCount[slot] = { ...cats };
  }

  const results = [];
  for (const item of misplaced) {
    const zone = zonaForCategoria(item.categoria);
    const candidates = slotsForLetters(zoneSlotsOrdered, zone);
    if (!candidates.length) {
      results.push({ ...item, destino: '(sin zona)' });
      continue;
    }

    const scored = candidates.map((slot) => {
      const sameCat = catCount[slot]?.[item.categoria] ?? 0;
      const items = load[slot] ?? 0;
      const emptyBonus = items === 0 ? 1000 : 0;
      const sameCatScore = sameCat > 0 ? 500 + sameCat * 10 : 0;
      const loadPenalty = -items;
      return { slot, score: emptyBonus + sameCatScore + loadPenalty };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return candidates.indexOf(a.slot) - candidates.indexOf(b.slot);
    });

    const destino = scored[0].slot;
    load[destino] = (load[destino] ?? 0) + 1;
    if (!catCount[destino]) catCount[destino] = {};
    catCount[destino][item.categoria] = (catCount[destino][item.categoria] ?? 0) + 1;
    results.push({ ...item, destino });
  }
  return results;
}

function cell(text, opts = {}) {
  const { bold = false, width = 2000, header = false } = opts;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { fill: '1F4E79' } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ''),
            bold: bold || header,
            color: header ? 'FFFFFF' : '000000',
            size: header ? 18 : 16,
          }),
        ],
      }),
    ],
  });
}

function buildTable(rows) {
  const widths = [1400, 4200, 1400, 1600];
  const header = new TableRow({
    children: [
      cell('SKU', { header: true, width: widths[0], bold: true }),
      cell('Nombre', { header: true, width: widths[1], bold: true }),
      cell('Está en', { header: true, width: widths[2], bold: true }),
      cell('Debería estar', { header: true, width: widths[3], bold: true }),
    ],
  });
  const body = rows.map(
    (r) =>
      new TableRow({
        children: [
          cell(r.sku, { width: widths[0] }),
          cell(r.nombre, { width: widths[1] }),
          cell(r.slotActual, { width: widths[2] }),
          cell(r.destino, { width: widths[3], bold: true }),
        ],
      })
  );
  return new Table({
    width: { size: 8600, type: WidthType.DXA },
    columnWidths: widths,
    rows: [header, ...body],
  });
}

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function main() {
  const tsPath = join(ROOT, 'src/data/ubicacionesMuebleA.ts');
  const catPath = join(ROOT, 'exports/productos-catalogo.json');
  if (!existsSync(tsPath)) throw new Error(`Falta ${tsPath}`);
  if (!existsSync(catPath)) throw new Error(`Falta ${catPath}`);

  const mueble = parseMueblePorSlot(tsPath);
  const { byCode } = loadCatalog(catPath);

  const allSlotsAPP = Object.keys(mueble).filter(isSlotAPP);
  // Orden natural: A, A1…Z10, AA…PP
  allSlotsAPP.sort((a, b) => {
    const La = letterOfSlot(a);
    const Lb = letterOfSlot(b);
    const ia = LETTERS_APP.indexOf(La);
    const ib = LETTERS_APP.indexOf(Lb);
    if (ia !== ib) return ia - ib;
    const na = parseInt(a.replace(/^[A-Za-zÑñ]+/u, '') || '0', 10);
    const nb = parseInt(b.replace(/^[A-Za-zÑñ]+/u, '') || '0', 10);
    return na - nb;
  });

  const slotLoad = {};
  const slotCatCount = {};
  const missingCodes = [];
  const sinZona = [];
  const placements = []; // unique sku+slot

  const seen = new Set();
  for (const slot of allSlotsAPP) {
    const codes = mueble[slot] ?? [];
    slotLoad[slot] = 0;
    slotCatCount[slot] = {};
    for (const raw of codes) {
      const key = normSkuBarcode(raw);
      if (!key) continue;
      const dedupe = `${key}@@${slot}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const product = byCode.get(key);
      if (!product) {
        missingCodes.push({ code: raw, slot });
        continue;
      }

      const categoria = normCategoria(product.categoria) || '(SIN CATEGORIA)';
      slotLoad[slot] += 1;
      slotCatCount[slot][categoria] = (slotCatCount[slot][categoria] ?? 0) + 1;

      placements.push({
        sku: product.sku || raw,
        nombre: product.nombre || '(sin nombre)',
        categoria,
        slotActual: slot,
        letter: letterOfSlot(slot),
      });
    }
  }

  const misplaced = [];
  const pendientes = [];
  for (const p of placements) {
    if (CATEGORIAS_PENDIENTES.has(p.categoria)) {
      pendientes.push(p);
      continue;
    }
    const zona = zonaForCategoria(p.categoria);
    if (!zona) {
      sinZona.push(p);
      continue;
    }
    if (!zona.includes(p.letter)) {
      misplaced.push(p);
    }
  }

  misplaced.sort((a, b) => {
    const c = a.categoria.localeCompare(b.categoria, 'es');
    if (c) return c;
    const s = a.slotActual.localeCompare(b.slotActual, 'es');
    if (s) return s;
    return String(a.sku).localeCompare(String(b.sku), 'es');
  });

  // Orden de candidatos: prioridad de letras del plan (flatten unique)
  const zoneSlotsOrdered = [];
  const seenSlot = new Set();
  for (const letters of Object.values(ZONA_POR_CATEGORIA)) {
    for (const L of letters) {
      for (const slot of allSlotsAPP) {
        if (letterOfSlot(slot) === L && !seenSlot.has(slot)) {
          seenSlot.add(slot);
          zoneSlotsOrdered.push(slot);
        }
      }
    }
  }
  for (const slot of allSlotsAPP) {
    if (!seenSlot.has(slot)) zoneSlotsOrdered.push(slot);
  }

  const assigned = assignDestinations(misplaced, slotLoad, slotCatCount, zoneSlotsOrdered);

  const byCat = {};
  for (const r of assigned) {
    byCat[r.categoria] = (byCat[r.categoria] ?? 0) + 1;
  }

  const outDir = join(ROOT, 'exports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `Reubicacion_muebles_A-PP_${todayStamp()}.docx`);

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: 'Reubicación de muebles A–PP (plan de piso)', bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Generado: ${new Date().toLocaleString('es-MX')} · Estantes A–PP (Mostrador, BANDAS y Cajonera excluidos).`,
          italics: true,
          size: 18,
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Resumen')],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Productos a reubicar: ${assigned.length}. Otras categorías sin zona: ${sinZona.length}. Códigos sin match en catálogo: ${missingCodes.length}.`,
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun('Acomodo de muebles A–PP')],
    }),
    ...ZONAS_RESUMEN.map(
      ([cat, zona]) =>
        new Paragraph({
          children: [
            new TextRun({ text: `${cat}: `, bold: true }),
            new TextRun(zona),
          ],
        })
    ),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun('A mover por categoría')],
    }),
    ...Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([cat, n]) =>
          new Paragraph({
            children: [new TextRun(`${cat}: ${n}`)],
          })
      ),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Para reubicar')],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'Lista de productos fuera de su zona. Cada fila indica dónde está y a qué slot conviene moverlo (mismo tipo junto o lo más cerca posible).',
          size: 18,
        }),
      ],
    }),
  ];

  if (assigned.length) {
    children.push(buildTable(assigned));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400 },
        children: [new TextRun('Lista narrativa')],
      })
    );
    for (const r of assigned) {
      children.push(
        new Paragraph({
          children: [
            new TextRun('En el mueble '),
            new TextRun({ text: r.slotActual, bold: true }),
            new TextRun(' está el SKU '),
            new TextRun({ text: String(r.sku), bold: true }),
            new TextRun(` (${r.nombre}) que debería estar en el mueble `),
            new TextRun({ text: r.destino, bold: true }),
            new TextRun('.'),
          ],
        })
      );
    }
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun('No hay productos mal ubicados según las zonas definidas.')],
      })
    );
  }

  if (pendientes.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun('Pendientes (estufas, boiler, licuadoras)')],
      }),
      new Paragraph({
        children: [
          new TextRun(
            'Sin destino forzado por ahora. Se listan con su ubicación actual para decidir después.'
          ),
        ],
      })
    );
    for (const r of [...pendientes].sort((a, b) => {
      const c = a.categoria.localeCompare(b.categoria, 'es');
      if (c) return c;
      return a.slotActual.localeCompare(b.slotActual, 'es');
    })) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${r.sku} `, bold: true }),
            new TextRun(`— ${r.nombre} — está en ${r.slotActual} (${r.categoria})`),
          ],
        })
      );
    }
  }

  if (sinZona.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun('Otras categorías sin zona (solo referencia)')],
      }),
      new Paragraph({
        children: [
          new TextRun(
            'Categorías no cubiertas por el plan de piso. Se listan con ubicación actual:'
          ),
        ],
      })
    );
    for (const r of sinZona.sort((a, b) => a.slotActual.localeCompare(b.slotActual, 'es'))) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${r.sku} `, bold: true }),
            new TextRun(`— ${r.nombre} — está en ${r.slotActual} (${r.categoria})`),
          ],
        })
      );
    }
  }

  if (missingCodes.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun('Códigos en mapa sin producto en catálogo')],
      })
    );
    for (const m of missingCodes) {
      children.push(
        new Paragraph({
          children: [new TextRun(`${m.code} en ${m.slot}`)],
        })
      );
    }
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Exclusiones')],
    }),
    new Paragraph({
      children: [
        new TextRun(
          'Mostrador, BANDAS y Cajonera no se modifican ni se listan para reubicación. Este documento no altera ubicacionesMuebleA.ts ni Supabase.'
        ),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);

  // JSON auxiliar para auditoría rápida
  const jsonPath = outPath.replace(/\.docx$/i, '.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalReubicar: assigned.length,
        byCategoria: byCat,
        missingCodes: missingCodes.length,
        sinZona: sinZona.length,
        pendientes: pendientes.length,
        items: assigned.map((r) => ({
          sku: r.sku,
          nombre: r.nombre,
          categoria: r.categoria,
          estaEn: r.slotActual,
          deberiaEstar: r.destino,
        })),
        pendientesItems: pendientes.map((r) => ({
          sku: r.sku,
          nombre: r.nombre,
          categoria: r.categoria,
          estaEn: r.slotActual,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`OK: ${outPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`A reubicar: ${assigned.length}`);
  console.log(`Pendientes: ${pendientes.length}`);
  console.log(
    Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `  ${c}: ${n}`)
      .join('\n')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
