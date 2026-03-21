/** Zona horaria única para toda la app (Hermosillo, Sonora). */
export const APP_TIMEZONE = 'America/Hermosillo';

export function formatInAppTimezone(
  date: Date,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat('es-MX', {
    ...options,
    timeZone: APP_TIMEZONE,
  }).format(date);
}
