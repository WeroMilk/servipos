/**
 * Lista de proveedores en Configuración: una línea por proveedor.
 * Formato opcional: `CODIGO|NOMBRE` (el código es solo para búsqueda e historial; en el producto se guarda el nombre).
 * Líneas sin `|` se interpretan como nombre solo (retrocompatible).
 */

function upperEs(s: string): string {
  return s.trim().toLocaleUpperCase('es');
}

export function parseProveedorLine(raw: string): { codigo: string; nombre: string } {
  const t = raw.trim();
  if (!t) return { codigo: '', nombre: '' };
  const i = t.indexOf('|');
  if (i >= 0) {
    const codigo = upperEs(t.slice(0, i));
    const nombre = upperEs(t.slice(i + 1));
    return { codigo, nombre };
  }
  return { codigo: '', nombre: upperEs(t) };
}

/** Si el valor guardado era la línea completa `COD|NOMBRE`, devuelve solo el nombre en mayúsculas. */
export function normalizeProveedorNombreGuardado(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return parseProveedorLine(t).nombre || upperEs(t);
}

export function buildProveedorNombrePorLinea(
  lines: string[]
): Map<string, { codigo: string; nombre: string }> {
  const m = new Map<string, { codigo: string; nombre: string }>();
  for (const line of lines) {
    const p = parseProveedorLine(line);
    if (!p.nombre) continue;
    if (!m.has(p.nombre)) m.set(p.nombre, p);
  }
  return m;
}

export function lookupProveedorCodigo(nombreProveedor: string, lines: string[]): string | undefined {
  const n = normalizeProveedorNombreGuardado(nombreProveedor);
  if (!n) return undefined;
  const row = buildProveedorNombrePorLinea(lines).get(n);
  const c = row?.codigo?.trim();
  return c && c.length > 0 ? c : undefined;
}

export function formatProveedorHistorialLinea(proveedor?: string, proveedorCodigo?: string): string {
  const n = proveedor?.trim();
  const c = proveedorCodigo?.trim();
  if (!n && !c) return '';
  if (c && n) return `${c} · ${n}`;
  return n || c || '';
}

/** Si no hay código en el movimiento, intenta obtenerlo de la lista actual de proveedores (Configuración). */
export function formatProveedorHistorialLineaResuelto(
  proveedor?: string,
  proveedorCodigo?: string,
  listaProveedores?: string[]
): string {
  const codGuardado = proveedorCodigo?.trim();
  const codLista =
    !codGuardado && proveedor?.trim() && listaProveedores && listaProveedores.length > 0
      ? lookupProveedorCodigo(proveedor, listaProveedores)
      : undefined;
  const cod = codGuardado || codLista;
  return formatProveedorHistorialLinea(proveedor, cod);
}

export function proveedorSelectItemLabel(
  nombre: string,
  map: Map<string, { codigo: string; nombre: string }>
): string {
  const row = map.get(nombre);
  const c = row?.codigo?.trim();
  return c && c.length > 0 ? `${c} — ${nombre}` : nombre;
}
