import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  HeightRule,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { Product } from '@/types';
import {
  BUILTIN_CLIENT_PRICE_LIST_ORDER,
  CLIENT_PRICE_LABELS,
  type BuiltinClientPriceListId,
} from '@/lib/clientPriceLists';
import { getProductUnitConIvaForClienteList } from '@/lib/productListPricing';
import { productEsServicio } from '@/lib/productServicio';
import { formatMoney } from '@/lib/utils';
import { formatInAppTimezone } from '@/lib/appTimezone';

const THIN = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** Carta horizontal (twips). */
const PAGE_W = 15840;
const PAGE_H = 12240;
const MARGIN = 720;
const USABLE = PAGE_W - 2 * MARGIN;

const COL_SKU = 1400;
const COL_NOMBRE = 3200;
const COL_MONEY = 1280;
const COL_FOTO = USABLE - COL_SKU - COL_NOMBRE - COL_MONEY * 6;

function moneyCell(text: string, opts?: { header?: boolean; fill?: string }): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: COL_MONEY, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts?.fill ? { fill: opts.fill, type: 'clear' } : undefined,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text,
            bold: opts?.header,
            size: opts?.header ? 16 : 15,
            font: 'Calibri',
            color: opts?.header ? 'FFFFFF' : '111111',
          }),
        ],
      }),
    ],
  });
}

function textCell(
  text: string,
  width: number,
  opts?: { header?: boolean; fill?: string; center?: boolean; gray?: boolean }
): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts?.fill ? { fill: opts.fill, type: 'clear' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: opts?.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({
            text,
            bold: opts?.header,
            italics: opts?.gray,
            size: opts?.header ? 16 : 16,
            font: 'Calibri',
            color: opts?.header ? 'FFFFFF' : opts?.gray ? 'AAAAAA' : '111111',
          }),
        ],
      }),
    ],
  });
}

export function catalogProductsForWord(products: readonly Product[]): Product[] {
  return products
    .filter((p) => p && p.activo !== false && !productEsServicio(p))
    .slice()
    .sort((a, b) => {
      const sku = String(a.sku ?? '').localeCompare(String(b.sku ?? ''), 'es', { numeric: true });
      if (sku !== 0) return sku;
      return String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es');
    });
}

function costoLabel(p: Product): string {
  const c = Number(p.precioCompra);
  if (!Number.isFinite(c) || c <= 0) return '—';
  return formatMoney(c);
}

export function buildProductCatalogDocument(opts: {
  products: readonly Product[];
  sucursalNombre?: string;
  generatedAt?: Date;
}): Document {
  const generatedAt = opts.generatedAt ?? new Date();
  const rows = catalogProductsForWord(opts.products);
  const fechaStr = formatInAppTimezone(generatedAt, { dateStyle: 'long' });
  const sucursal = opts.sucursalNombre?.trim() || 'modo local';

  const headerFill = '1F4E79';
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      textCell('SKU', COL_SKU, { header: true, fill: headerFill }),
      textCell('Nombre', COL_NOMBRE, { header: true, fill: headerFill }),
      moneyCell('Costo', { header: true, fill: headerFill }),
      ...BUILTIN_CLIENT_PRICE_LIST_ORDER.map((id) =>
        moneyCell(CLIENT_PRICE_LABELS[id as BuiltinClientPriceListId], { header: true, fill: headerFill })
      ),
      textCell('Foto', COL_FOTO, { header: true, fill: headerFill, center: true }),
    ],
  });

  const bodyRows = rows.map((p) => {
    return new TableRow({
      height: { value: 1134, rule: HeightRule.ATLEAST },
      children: [
        textCell(String(p.sku ?? ''), COL_SKU),
        textCell(String(p.nombre ?? ''), COL_NOMBRE),
        moneyCell(costoLabel(p)),
        ...BUILTIN_CLIENT_PRICE_LIST_ORDER.map((id) =>
          moneyCell(formatMoney(getProductUnitConIvaForClienteList(p, id)))
        ),
        textCell('Foto', COL_FOTO, { center: true, gray: true }),
      ],
    });
  });

  return new Document({
    creator: 'SERVIPARTZ POS',
    title: 'Catálogo de precios SERVIPARTZ',
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: PAGE_W,
              height: PAGE_H,
            },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'SERVIPARTZ  ·  Catálogo de artículos (activos)',
                    bold: true,
                    size: 22,
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: 'SKU, costo, precios de caja y espacio para foto',
                bold: true,
                size: 28,
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `Sucursal: ${sucursal}  ·  Generado: ${fechaStr}  ·  ${rows.length} artículos  ·  Precios con IVA (como en caja). Costo = precio de compra del catálogo.`,
                size: 18,
                font: 'Calibri',
                color: '555555',
              }),
            ],
          }),
          new Table({
            width: { size: USABLE, type: WidthType.DXA },
            rows: [headerRow, ...bodyRows],
          }),
          new Paragraph({
            spacing: { before: 200 },
            children: [
              new TextRun({
                text: 'Página ',
                size: 16,
                font: 'Calibri',
                color: '888888',
              }),
              new TextRun({
                children: [PageNumber.CURRENT],
                size: 16,
                font: 'Calibri',
                color: '888888',
              }),
            ],
          }),
        ],
      },
    ],
  });
}

function slugFechaArchivo(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function downloadProductCatalogWord(opts: {
  products: readonly Product[];
  sucursalNombre?: string;
}): Promise<number> {
  const doc = buildProductCatalogDocument(opts);
  const blob = await Packer.toBlob(doc);
  const n = catalogProductsForWord(opts.products).length;
  const name = `Catalogo_precios_SERVIPARTZ_${slugFechaArchivo(new Date())}.docx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return n;
}
