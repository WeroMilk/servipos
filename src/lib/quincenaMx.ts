import { addDays } from 'date-fns';
import { APP_TIMEZONE } from '@/lib/appTimezone';

// ============================================
// Fecha y quincena (zona Hermosillo, Sonora)
// ============================================

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** YYYY-MM-DD en zona Hermosillo (Sonora). */
export function getMexicoDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function getMexicoNowParts(d: Date = new Date()): { y: string; m: string; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((x) => x.type === 'year')!.value;
  const m = parts.find((x) => x.type === 'month')!.value;
  const day = parseInt(parts.find((x) => x.type === 'day')!.value, 10);
  return { y, m, day };
}

/** Id estable: `YYYY-MM-1` (días 1–15) o `YYYY-MM-2` (16–fin). */
export function quincenaIdFromDateKey(dateKey: string): string {
  const [ys, ms, ds] = dateKey.split('-');
  const day = parseInt(ds, 10);
  const half = day <= 15 ? '1' : '2';
  return `${ys}-${ms}-${half}`;
}

export function getCurrentQuincenaId(): string {
  return quincenaIdFromDateKey(getMexicoDateKey());
}

function prevQuincenaId(id: string): string {
  const [ys, ms, qs] = id.split('-');
  let y = parseInt(ys, 10);
  let m = parseInt(ms, 10);
  const q = qs;
  if (q === '2') {
    return `${y}-${String(m).padStart(2, '0')}-1`;
  }
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-2`;
}

/** Últimas `n` quincenas incluyendo la actual (más reciente primero). */
export function recentQuincenaIds(n: number): string[] {
  let cur = getCurrentQuincenaId();
  const out: string[] = [cur];
  for (let i = 1; i < n; i++) {
    cur = prevQuincenaId(cur);
    out.push(cur);
  }
  return out;
}

export function formatQuincenaLabel(id: string): string {
  const [y, m, q] = id.split('-');
  const mi = parseInt(m, 10) - 1;
  const month = MONTHS_ES[mi] ?? m;
  return `${month} ${y} · ${q === '1' ? '1ª' : '2ª'} quincena`;
}

export function formatTimeMx(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

/** dd/mm/yyyy para tabla (Hermosillo). */
export function formatDateKeyMx(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

/** Ancla de calendario en medianoche local a partir de YYYY-MM-DD (Hermosillo). */
export function startOfDayFromDateKey(dateKey: string): Date {
  const [ys, ms, ds] = dateKey.split('-');
  const y = parseInt(ys!, 10);
  const m = parseInt(ms!, 10);
  const d = parseInt(ds!, 10);
  const x = new Date(y, m - 1, d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Suma días a una fecha YYYY-MM-DD (calendario Hermosillo). */
export function addDaysToMexicoDateKey(dateKey: string, deltaDays: number): string {
  return getMexicoDateKey(addDays(startOfDayFromDateKey(dateKey), deltaDays));
}

/** Día de la semana en zona app (Hermosillo): 0=domingo … 6=sábado. */
export function getMexicoWeekdaySun0(dateKey: string): number {
  const [ys, ms, ds] = dateKey.split('-');
  const y = parseInt(ys!, 10);
  const mo = parseInt(ms!, 10);
  const d = parseInt(ds!, 10);
  const utcNoon = Date.UTC(y, mo - 1, d, 19, 0, 0);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  }).format(new Date(utcNoon));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

export function isMexicoSunday(dateKey: string): boolean {
  return getMexicoWeekdaySun0(dateKey) === 0;
}

/**
 * Los domingos no se avanza de bloque: misma partición que el sábado (misma clave de almacenamiento).
 */
export function effectiveDateKeyForMissionPartition(dateKey: string): string {
  if (isMexicoSunday(dateKey)) {
    return addDaysToMexicoDateKey(dateKey, -1);
  }
  return dateKey;
}

/**
 * Ciclo bimestral (ene–feb, mar–abr, …) para inventario por misiones.
 * `dayIndex` 0 = primer día del periodo; el último día cubre hasta completar el catálogo.
 */
export function getBimonthCycleInfo(dateKey: string): {
  periodStartKey: string;
  periodEndKey: string;
  dayIndex: number;
  daysInCycle: number;
  cycleLabelEs: string;
  cycleId: string;
} {
  const [ys, ms] = dateKey.split('-');
  const y = parseInt(ys!, 10);
  const month = parseInt(ms!, 10);
  const monthStart = month % 2 === 1 ? month : month - 1;
  const monthEnd = monthStart + 1;
  const periodStartKey = `${y}-${String(monthStart).padStart(2, '0')}-01`;
  const lastDayNum = new Date(y, monthEnd, 0).getDate();
  const periodEndKey = `${y}-${String(monthEnd).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  const startMs = startOfDayFromDateKey(periodStartKey).getTime();
  const endMs = startOfDayFromDateKey(periodEndKey).getTime();
  const curMs = startOfDayFromDateKey(dateKey).getTime();
  const dayIndex = Math.max(0, Math.round((curMs - startMs) / 86_400_000));
  const daysInCycle = Math.round((endMs - startMs) / 86_400_000) + 1;

  const label = `${MONTHS_ES[monthStart - 1] ?? ''}–${MONTHS_ES[monthEnd - 1] ?? ''} ${y}`;
  const cycleId = `${y}-${String(monthStart).padStart(2, '0')}`;

  return {
    periodStartKey,
    periodEndKey,
    dayIndex: Math.min(dayIndex, Math.max(0, daysInCycle - 1)),
    daysInCycle,
    cycleLabelEs: label,
    cycleId,
  };
}
