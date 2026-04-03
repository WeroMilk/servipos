import type { Product } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, CLIENT_PRICE_LABELS } from '@/lib/clientPriceLists';
import { formatInAppTimezone } from '@/lib/appTimezone';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esStockBajo(p: { existencia: number; existenciaMinima: number }): boolean {
  if (p.existencia <= 0) return true;
  if (p.existenciaMinima > 0 && p.existencia / p.existenciaMinima < 0.15) return true;
  return p.existencia <= p.existenciaMinima;
}

function slugArchivo(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

/** Columna Excel 1-based → letra (A, B, …, Z, AA, …). */
function colLetter1Based(col1: number): string {
  let c = col1;
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

/**
 * Genera y descarga un .xlsx con el catálogo (orden: categoría, nombre).
 * Configurado para imprimir en **papel carta (Letter 8.5×11")**: orientación horizontal,
 * ajuste a 1 página de ancho, márgenes estándar, fila de encabezados repetida en cada hoja.
 */
export async function downloadInventarioCompletoXlsx(opts: {
  products: Product[];
  sucursalNombre?: string;
}): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const { products, sucursalNombre } = opts;
  const sorted = [...products].sort((a, b) => {
    const c = (a.categoria || '').localeCompare(b.categoria || '', 'es');
    if (c !== 0) return c;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });

  const listHeaderCols = CLIENT_PRICE_LIST_ORDER.map(
    (id) => `Precio lista ${CLIENT_PRICE_LABELS[id]} (s/IVA)`
  );

  const headers = [
    '#',
    'SKU',
    'Código de barras',
    'Nombre',
    'Descripción',
    'Categoría',
    'Proveedor',
    'Unidad SAT',
    'Clave prod/serv',
    'Existencia',
    'Existencia mínima',
    'Stock bajo',
    'Precio venta (s/IVA)',
    '% IVA',
    'Precio compra (s/IVA)',
    'Valor al costo (exist × compra)',
    'Valor venta s/IVA (exist × P. venta)',
    ...listHeaderCols,
    'Activo',
  ];

  const colCount = headers.length;
  const now = new Date();
  const fechaStr = formatInAppTimezone(now, { dateStyle: 'long', timeStyle: 'short' });
  const fechaArchivo = formatInAppTimezone(now, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .replace(/[/:]/g, '-')
    .replace(/\s+/g, '_');

  const metaLine = [
    sucursalNombre?.trim() ? `Sucursal: ${sucursalNombre.trim()}` : 'Sucursal: modo local',
    `Generado: ${fechaStr}`,
    `Artículos: ${sorted.length}`,
  ].join('  ·  ');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SERVIPARTZ POS';
  wb.created = now;
  wb.modified = now;

  const ws = wb.addWorksheet('Inventario', {
    properties: { defaultRowHeight: 17 },
    views: [{ state: 'frozen', ySplit: 4, xSplit: 0 }],
    pageSetup: {
      /** Letter (carta 8.5×11") es el predeterminado de Excel cuando no se define paperSize */
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      /** 0 = Excel no fuerza alto; el listado puede ocupar varias hojas en carta. */
      fitToHeight: 0,
      margins: {
        left: 0.5,
        right: 0.5,
        top: 0.55,
        bottom: 0.55,
        header: 0.35,
        footer: 0.35,
      },
      horizontalCentered: true,
      printTitlesRow: '4:4',
      showGridLines: true,
    },
    headerFooter: {
      oddFooter: '&C&Página &P de &N',
    },
  });

  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'INVENTARIO COMPLETO — SERVIPARTZ POS';
  titleCell.font = { name: 'Calibri', size: 16, bold: true };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };

  ws.mergeCells(2, 1, 2, colCount);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = metaLine;
  metaCell.font = { name: 'Calibri', size: 11 };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF64748B' } },
      bottom: { style: 'thin', color: { argb: 'FF64748B' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  let idx = 0;
  for (const p of sorted) {
    idx++;
    const exist = Number(p.existencia) || 0;
    const pCompra = p.precioCompra;
    const valorCosto =
      pCompra != null && Number.isFinite(pCompra) ? round2(exist * pCompra) : '';
    const valorVentaSinIva = round2(exist * (Number(p.precioVenta) || 0));
    const listCols = CLIENT_PRICE_LIST_ORDER.map((id) => {
      const v = p.preciosPorListaCliente?.[id];
      return v != null && Number.isFinite(v) ? round2(v) : '';
    });

    const rowVals: (string | number)[] = [
      idx,
      p.sku,
      p.codigoBarras ?? '',
      p.nombre,
      p.descripcion ?? '',
      p.categoria ?? '',
      p.proveedor ?? '',
      p.unidadMedida ?? '',
      p.claveProdServ ?? '',
      exist,
      Number(p.existenciaMinima) || 0,
      esStockBajo(p) ? 'Sí' : 'No',
      round2(Number(p.precioVenta) || 0),
      Number(p.impuesto) || 0,
      pCompra != null && Number.isFinite(pCompra) ? round2(pCompra) : '',
      valorCosto === '' ? '' : valorCosto,
      valorVentaSinIva,
      ...listCols,
      p.activo !== false ? 'Sí' : 'No',
    ];

    const r = ws.addRow(rowVals);
    r.font = { name: 'Calibri', size: 10 };
    r.eachCell((cell, colNumber) => {
      const v = rowVals[colNumber - 1];
      const isNum = typeof v === 'number';
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 ? 'center' : isNum ? 'right' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        left: { style: 'hair', color: { argb: 'FFF1F5F9' } },
        right: { style: 'hair', color: { argb: 'FFF1F5F9' } },
      };
    });
  }

  const wch: number[] = [5, 14, 16, 42, 28, 16, 18, 10, 8, 12, 12, 10, 14, 8, 16, 22, 22];
  while (wch.length < colCount) wch.push(14);
  for (let i = 0; i < colCount; i++) {
    ws.getColumn(i + 1).width = wch[i] ?? 14;
  }

  const lastDataRow = 4 + sorted.length;
  const lastColLet = colLetter1Based(colCount);
  ws.pageSetup.printArea = `A1:${lastColLet}${lastDataRow}`;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suf = sucursalNombre?.trim() ? `_${slugArchivo(sucursalNombre.trim())}` : '';
  const fname = `Inventario${suf}_${fechaArchivo}.xlsx`;
  a.href = url;
  a.download = fname;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
