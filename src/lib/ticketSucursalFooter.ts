/**
 * Texto fijo del pie del ticket / documentos por id de sucursal (Firestore `sucursales/{id}`).
 * Matriz y Olivares comparten domicilio y horario; el título distingue la tienda.
 */
const CONTACT_LINES = [
  'Contacto',
  '662 404 9965',
  'Av. José San Healy 385, Olivares, 83180 Hermosillo, Son.',
  'Horario',
  'Lunes a Viernes: 8:00 a.m. – 6:30 p.m.',
  'Sábado: 8:00 a.m. – 2:00 p.m.',
  'Domingo: Cerrado',
] as const;

const MATRIZ_LINES = ['Matriz', ...CONTACT_LINES] as const;
const OLIVARES_LINES = ['Olivares', ...CONTACT_LINES] as const;

const FOOTERS: Record<string, readonly string[]> = {
  matriz: MATRIZ_LINES,
  /** Si la matriz usa el id por defecto del proyecto en lugar de `matriz`. */
  principal: MATRIZ_LINES,
  olivares: OLIVARES_LINES,
};

export function getThermalTicketSucursalFooterLines(sucursalId?: string | null): readonly string[] | null {
  const key = sucursalId?.trim().toLowerCase();
  if (!key) return null;
  return FOOTERS[key] ?? null;
}

/** Líneas de pie para impresión carta / PDF (sin título repetido si no hay match). */
export function getDocumentFooterLinesForSucursal(sucursalId?: string | null): string[] {
  const lines = getThermalTicketSucursalFooterLines(sucursalId);
  return lines ? [...lines] : ['SERVIPARTZ', ...CONTACT_LINES];
}
