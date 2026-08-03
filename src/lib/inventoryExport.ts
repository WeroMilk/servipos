import type { Product } from '@/types';
import { getClientPriceListCatalogFromStore } from '@/lib/clientPriceListCatalog';
import { getProductPrecioPublicoRegular } from '@/lib/productListPricing';
import { formatInAppTimezone } from '@/lib/appTimezone';
import { productEsServicio } from '@/lib/productServicio';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esStockBajo(p: Product): boolean {
  if (productEsServicio(p)) return false;
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
  downloadInventarioCsv({
    products: opts.products,
    sucursalNombre: opts.sucursalNombre,
    title: 'INVENTARIO COMPLETO — SERVIPARTZ POS',
    filePrefix: 'Inventario',
  });
}

/**
 * Descarga solo artículos con stock bajo (mismo criterio que la tarjeta «Stock bajo» en Inventario).
 */
export function downloadInventarioStockBajo(opts: {
  products: Product[];
  sucursalNombre?: string;
}): void {
  const filtered = opts.products.filter(esStockBajo);
  downloadInventarioCsv({
    products: filtered,
    sucursalNombre: opts.sucursalNombre,
    title: 'STOCK BAJO — SERVIPARTZ POS',
    filePrefix: 'Stock_bajo',
  });
}

/**
 * CSV para pedir a proveedores los artículos seleccionados del alert «Stock bajo» del panel.
 */
export function downloadPedidoStockBajo(opts: {
  products: Product[];
  sucursalNombre?: string;
}): void {
  const products = opts.products.filter((p) => p && p.id);
  const sorted = [...products].sort((a, b) => {
    const prov = (a.proveedor || '').localeCompare(b.proveedor || '', 'es');
    if (prov !== 0) return prov;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });

  const headers = [
    '#',
    'SKU',
    'Nombre',
    'Proveedor',
    'Categoría',
    'Existencia',
    'Existencia mínima',
    'Cantidad sugerida',
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
    opts.sucursalNombre?.trim() ? `Sucursal: ${opts.sucursalNombre.trim()}` : 'Sucursal: modo local',
    `Generado: ${fechaStr}`,
    `Artículos a pedir: ${sorted.length}`,
  ].join(' · ');

  const lines: string[] = [];
  lines.push(csvField('PEDIDO A PROVEEDORES — STOCK BAJO — SERVIPARTZ POS'));
  lines.push(csvField(metaLine));
  lines.push('');
  lines.push(headers.map(csvField).join(','));

  let idx = 0;
  for (const p of sorted) {
    idx++;
    const exist = Number(p.existencia) || 0;
    const min = Number(p.existenciaMinima) || 0;
    const sugerida = Math.max(min - exist, 1);
    lines.push(
      [
        idx,
        p.sku,
        p.nombre,
        p.proveedor ?? '',
        p.categoria ?? '',
        exist,
        min,
        sugerida,
      ]
        .map(csvField)
        .join(',')
    );
  }

  const csvBody = lines.join('\r\n');
  const blob = new Blob(['\uFEFF', csvBody], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suf = opts.sucursalNombre?.trim() ? `_${slugArchivo(opts.sucursalNombre.trim())}` : '';
  a.href = url;
  a.download = `Pedido_stock_bajo${suf}_${fechaArchivo}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadInventarioCsv(opts: {
  products: Product[];
  sucursalNombre?: string;
  title: string;
  filePrefix: string;
}): void {
  const { products, sucursalNombre, title, filePrefix } = opts;
  const sorted = [...products].sort((a, b) => {
    const c = (a.categoria || '').localeCompare(b.categoria || '', 'es');
    if (c !== 0) return c;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });

  const { ids: catalogIds, labels: catalogLabels } = getClientPriceListCatalogFromStore();

  const listHeaderCols = catalogIds.map(
    (id) => `Precio lista ${catalogLabels[id] ?? id} (valor en catálogo)`
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
    'Precio venta Regular (con IVA)',
    '% IVA',
    'Precio compra (s/IVA)',
    'Valor al costo (exist × compra)',
    'Valor venta (exist × precio Regular con IVA)',
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
  lines.push(csvField(title));
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
    const baseVenta = getProductPrecioPublicoRegular(p);
    const valorVentaConIva = round2(exist * baseVenta);
    const listCols = catalogIds.map((id) => {
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
      valorVentaConIva,
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
  const fname = `${filePrefix}${suf}_${fechaArchivo}.csv`;
  a.href = url;
  a.download = fname;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
