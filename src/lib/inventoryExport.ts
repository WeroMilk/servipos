import type { Product } from '@/types';
import { CLIENT_PRICE_LIST_ORDER, CLIENT_PRICE_LABELS } from '@/lib/clientPriceLists';
import { getProductPrecioBaseCatalogoSinIva } from '@/lib/productListPricing';
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

/** Escapa un campo para CSV (RFC básico; compatible con Excel en español). */
function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Descarga **todo** el inventario como CSV (sin librerías; evita fallos de chunks en producción).
 * Abre en Excel/LibreOffice; desde ahí se imprime o se guarda como .xlsx si lo desea.
 */
export function downloadInventarioCompleto(opts: {
  products: Product[];
  sucursalNombre?: string;
}): void {
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
  ].join(' · ');

  const lines: string[] = [];
  lines.push(csvField('INVENTARIO COMPLETO — SERVIPARTZ POS'));
  lines.push(csvField(metaLine));
  lines.push('');
  lines.push(headers.map(csvField).join(','));

  let idx = 0;
  for (const p of sorted) {
    idx++;
    const exist = Number(p.existencia) || 0;
    const pCompra = p.precioCompra;
    const valorCosto =
      pCompra != null && Number.isFinite(pCompra) ? round2(exist * pCompra) : '';
    const baseVenta = getProductPrecioBaseCatalogoSinIva(p);
    const valorVentaSinIva = round2(exist * baseVenta);
    const listCols = CLIENT_PRICE_LIST_ORDER.map((id) => {
      const v = p.preciosPorListaCliente?.[id];
      return v != null && Number.isFinite(v) ? round2(v) : '';
    });

    const row: (string | number)[] = [
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
      round2(baseVenta),
      Number(p.impuesto) || 0,
      pCompra != null && Number.isFinite(pCompra) ? round2(pCompra) : '',
      valorCosto === '' ? '' : valorCosto,
      valorVentaSinIva,
      ...listCols,
      p.activo !== false ? 'Sí' : 'No',
    ];
    lines.push(row.map(csvField).join(','));
  }

  const csvBody = lines.join('\r\n');
  const blob = new Blob(['\uFEFF', csvBody], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suf = sucursalNombre?.trim() ? `_${slugArchivo(sucursalNombre.trim())}` : '';
  const fname = `Inventario${suf}_${fechaArchivo}.csv`;
  a.href = url;
  a.download = fname;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
