/**
 * Texto fijo del pie del ticket térmico por id de sucursal (Firestore `sucursales/{id}`).
 * Añade aquí otras tiendas cuando las tengas.
 */
const MATRIZ_LINES = [
  'Matriz',
  'Contacto',
  '662 404 9965',
  'Av. José San Healy 385, Olivares, 83180 Hermosillo, Son.',
  'Horario',
  'Lunes a Viernes: 8:00 a.m. – 6:30 p.m.',
  'Sábado: 8:00 a.m. – 2:00 p.m.',
  'Domingo: Cerrado',
] as const;

const FOOTERS: Record<string, readonly string[]> = {
  matriz: MATRIZ_LINES,
  /** Si la matriz usa el id por defecto del proyecto en lugar de `matriz`. */
  principal: MATRIZ_LINES,
};

export function getThermalTicketSucursalFooterLines(sucursalId?: string | null): readonly string[] | null {
  const key = sucursalId?.trim().toLowerCase();
  if (!key) return null;
  return FOOTERS[key] ?? null;
}
