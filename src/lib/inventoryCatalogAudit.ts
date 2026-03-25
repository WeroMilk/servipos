import { formatMoney } from '@/lib/utils';
import type { Product } from '@/types';
import {
  CLIENT_PRICE_LIST_ORDER,
  CLIENT_PRICE_LABELS,
  type ClientPriceListId,
} from '@/lib/clientPriceLists';

const CATALOG_KEYS: (keyof Product)[] = [
  'sku',
  'codigoBarras',
  'nombre',
  'descripcion',
  'precioVenta',
  'precioCompra',
  'impuesto',
  'existencia',
  'existenciaMinima',
  'categoria',
  'proveedor',
  'unidadMedida',
  'activo',
  'preciosPorListaCliente',
  'imagen',
];

function normStr(v: unknown): string {
  return String(v ?? '').trim();
}

function moneyStr(n: unknown): string {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return '—';
  return formatMoney(x);
}

function normalizePreciosLista(
  m: Product['preciosPorListaCliente'] | undefined | null
): Record<string, number> {
  if (!m || typeof m !== 'object') return {};
  const o: Record<string, number> = {};
  for (const id of CLIENT_PRICE_LIST_ORDER) {
    const v = m[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) o[id] = v;
  }
  return o;
}

function preciosListaEqual(
  a: Product['preciosPorListaCliente'] | undefined,
  b: Product['preciosPorListaCliente'] | undefined
): boolean {
  return JSON.stringify(normalizePreciosLista(a)) === JSON.stringify(normalizePreciosLista(b));
}

function catalogValuesEqual(key: keyof Product, a: unknown, b: unknown): boolean {
  if (key === 'preciosPorListaCliente') {
    return preciosListaEqual(
      a as Product['preciosPorListaCliente'],
      b as Product['preciosPorListaCliente']
    );
  }
  if (key === 'precioVenta' || key === 'precioCompra' || key === 'impuesto') {
    const na = typeof a === 'number' ? a : Number(a);
    const nb = typeof b === 'number' ? b : Number(b);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
    return Math.round((Number(na) || 0) * 100) === Math.round((Number(nb) || 0) * 100);
  }
  if (key === 'existencia' || key === 'existenciaMinima') {
    return Math.round(Number(a) || 0) === Math.round(Number(b) || 0);
  }
  if (key === 'activo') {
    return Boolean(a) === Boolean(b);
  }
  return normStr(a) === normStr(b);
}

function formatFieldChange(key: keyof Product, prev: unknown, next: unknown): string {
  const label =
    key === 'sku'
      ? 'SKU'
      : key === 'codigoBarras'
        ? 'Código de barras'
        : key === 'nombre'
          ? 'Nombre'
          : key === 'descripcion'
            ? 'Descripción'
            : key === 'precioVenta'
              ? 'Precio venta (sin IVA)'
              : key === 'precioCompra'
                ? 'Precio compra (sin IVA)'
                : key === 'impuesto'
                  ? 'IVA %'
                  : key === 'existencia'
                    ? 'Existencia'
                    : key === 'existenciaMinima'
                      ? 'Existencia mínima'
                      : key === 'categoria'
                        ? 'Categoría'
                        : key === 'proveedor'
                          ? 'Proveedor'
                          : key === 'unidadMedida'
                            ? 'Unidad'
                            : key === 'activo'
                              ? 'Activo en catálogo'
                              : key === 'imagen'
                                ? 'Imagen (URL)'
                                : key === 'preciosPorListaCliente'
                                  ? 'Precios por lista cliente'
                                  : String(key);

  if (key === 'precioVenta' || key === 'precioCompra') {
    return `${label}: ${moneyStr(prev)} → ${moneyStr(next)}`;
  }
  if (key === 'impuesto') {
    return `${label}: ${Number(prev) || 0}% → ${Number(next) || 0}%`;
  }
  if (key === 'existencia' || key === 'existenciaMinima') {
    return `${label}: ${Math.round(Number(prev) || 0)} → ${Math.round(Number(next) || 0)}`;
  }
  if (key === 'activo') {
    const ps = Boolean(prev) ? 'Sí' : 'No';
    const ns = Boolean(next) ? 'Sí' : 'No';
    return `${label}: ${ps} → ${ns}`;
  }
  if (key === 'preciosPorListaCliente') {
    const lines: string[] = [`${label}:`];
    const before = normalizePreciosLista(prev as Product['preciosPorListaCliente']);
    const after = normalizePreciosLista(next as Product['preciosPorListaCliente']);
    const ids = new Set([...Object.keys(before), ...Object.keys(after)] as ClientPriceListId[]);
    for (const id of CLIENT_PRICE_LIST_ORDER) {
      if (!ids.has(id)) continue;
      const bv = before[id];
      const av = after[id];
      if (bv === av) continue;
      const lab = CLIENT_PRICE_LABELS[id];
      lines.push(
        `  · ${lab}: ${bv !== undefined ? moneyStr(bv) : '—'} → ${av !== undefined ? moneyStr(av) : '—'}`
      );
    }
    if (lines.length === 1) return '';
    return lines.join('\n');
  }
  const ps = normStr(prev) || '—';
  const ns = normStr(next) || '—';
  return `${label}: ${ps} → ${ns}`;
}

/**
 * Líneas de cambio respecto a `prev` solo para campos presentes en `updates`.
 */
export function diffProductCatalogUpdates(prev: Product, updates: Partial<Product>): string[] {
  const lines: string[] = [];
  for (const key of CATALOG_KEYS) {
    if (!(key in updates)) continue;
    const nextVal = updates[key];
    if (nextVal === undefined) continue;
    const prevVal = prev[key];
    if (catalogValuesEqual(key, prevVal, nextVal)) continue;
    const line = formatFieldChange(key, prevVal, nextVal);
    if (line) lines.push(line);
  }
  return lines;
}

export function formatProductAltaMotivo(p: {
  nombre: string;
  sku: string;
  codigoBarras?: string;
  precioVenta: number;
  precioCompra?: number;
  impuesto: number;
  existencia: number;
  existenciaMinima?: number;
  proveedor?: string;
  categoria?: string;
  unidadMedida?: string;
  descripcion?: string;
}): string {
  const parts = [
    'Alta de producto en catálogo.',
    `Nombre: ${normStr(p.nombre)}`,
    `SKU: ${normStr(p.sku)}`,
    p.codigoBarras ? `Código de barras: ${normStr(p.codigoBarras)}` : null,
    `Precio venta (sin IVA): ${moneyStr(p.precioVenta)}`,
    p.precioCompra != null && Number(p.precioCompra) > 0
      ? `Precio compra (sin IVA): ${moneyStr(p.precioCompra)}`
      : null,
    `IVA: ${Number(p.impuesto) || 0}%`,
    `Existencia inicial: ${Math.round(Number(p.existencia) || 0)}`,
    p.existenciaMinima != null && p.existenciaMinima > 0
      ? `Existencia mínima: ${Math.round(p.existenciaMinima)}`
      : null,
    p.proveedor ? `Proveedor: ${normStr(p.proveedor)}` : null,
    p.categoria ? `Categoría: ${normStr(p.categoria)}` : null,
    p.unidadMedida ? `Unidad: ${normStr(p.unidadMedida)}` : null,
    p.descripcion ? `Descripción: ${normStr(p.descripcion)}` : null,
  ].filter(Boolean) as string[];
  return parts.join('\n');
}

/** Línea final con quién registró el evento (visible en el historial). */
export function auditActorSuffix(usuarioId: string, displayName?: string | null): string {
  const n = displayName?.trim();
  if (n) return `\n— Registrado por: ${n}`;
  if (usuarioId && usuarioId !== 'system') return `\n— Registrado por: ${usuarioId}`;
  return '\n— Registrado por: sistema';
}

export function formatProductBajaMotivo(p: Product): string {
  return [
    'Baja de producto en catálogo (queda inactivo; el historial y ventas previas se conservan).',
    `Nombre: ${normStr(p.nombre)}`,
    `SKU: ${normStr(p.sku)}`,
    p.codigoBarras ? `Código de barras: ${normStr(p.codigoBarras)}` : null,
    `Existencia al dar de baja: ${Math.round(Number(p.existencia) || 0)}`,
    `Precio venta (sin IVA) registrado: ${moneyStr(p.precioVenta)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
