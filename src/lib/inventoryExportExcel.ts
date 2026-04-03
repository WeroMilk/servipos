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

/**
 * Genera y descarga un .xlsx con todo el catálogo cargado en pantalla (orden imprimible: categoría, nombre).
 */
export async function downloadInventarioCompletoXlsx(opts: {
  products: Product[];
  sucursalNombre?: string;
}): Promise<void> {
  const mod = await import('xlsx');
  const XLSX = mod.default ?? mod;

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

  const rows: (string | number)[][] = [];
  rows.push(['INVENTARIO COMPLETO — SERVIPARTZ POS']);
  rows.push([
    [
      sucursalNombre?.trim() ? `Sucursal: ${sucursalNombre.trim()}` : 'Sucursal: modo local',
      `Generado: ${fechaStr}`,
      `Artículos: ${sorted.length}`,
    ].join('  ·  '),
  ]);
  rows.push([]);
  rows.push(headers);

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

    rows.push([
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
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ];

  const wch: number[] = [5, 14, 16, 42, 28, 16, 18, 10, 8, 14, 12, 12, 14, 8, 16, 22, 22];
  while (wch.length < colCount) wch.push(14);
  ws['!cols'] = wch.slice(0, colCount).map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

  const suf = sucursalNombre?.trim() ? `_${slugArchivo(sucursalNombre.trim())}` : '';
  const fname = `Inventario${suf}_${fechaArchivo}.xlsx`;
  XLSX.writeFile(wb, fname);
}
