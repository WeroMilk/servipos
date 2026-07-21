export type BuscaminasDifficultyId = 'easy' | 'intermediate' | 'hard' | 'gabriel';

export type BuscaminasScoreEntry = {
  id: string;
  difficulty: BuscaminasDifficultyId;
  difficultyLabel: string;
  points: number;
  seconds: number;
  at: string; // ISO
};

const STORAGE_KEY = 'servipos:buscaminas-top5';
const TOP_N = 5;

/** Base de puntos por nivel (más difícil = más base). */
export const DIFFICULTY_SCORE_BASE: Record<BuscaminasDifficultyId, number> = {
  easy: 1000,
  intermediate: 3000,
  hard: 6000,
  gabriel: 15000,
};

export function computeBuscaminasPoints(
  difficulty: BuscaminasDifficultyId,
  seconds: number
): number {
  const base = DIFFICULTY_SCORE_BASE[difficulty] ?? 1000;
  const secs = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.max(0, base - secs * 2);
}

export function formatBuscaminasTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function compareScores(a: BuscaminasScoreEntry, b: BuscaminasScoreEntry): number {
  if (b.points !== a.points) return b.points - a.points;
  return a.seconds - b.seconds;
}

export function loadTop5(): BuscaminasScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: BuscaminasScoreEntry[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const difficulty = String(o.difficulty ?? '') as BuscaminasDifficultyId;
      if (!(difficulty in DIFFICULTY_SCORE_BASE)) continue;
      const points = Number(o.points);
      const seconds = Number(o.seconds);
      if (!Number.isFinite(points) || !Number.isFinite(seconds)) continue;
      out.push({
        id: String(o.id ?? `${Date.now()}-${out.length}`),
        difficulty,
        difficultyLabel: String(o.difficultyLabel ?? difficulty),
        points: Math.max(0, Math.round(points)),
        seconds: Math.max(0, Math.floor(seconds)),
        at: typeof o.at === 'string' && o.at.length > 0 ? o.at : new Date().toISOString(),
      });
    }
    return out.sort(compareScores).slice(0, TOP_N);
  } catch {
    return [];
  }
}

function saveTop5(entries: BuscaminasScoreEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, TOP_N)));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Registra una victoria; devuelve el ranking actualizado. */
export function recordWin(input: {
  difficulty: BuscaminasDifficultyId;
  difficultyLabel: string;
  seconds: number;
}): BuscaminasScoreEntry[] {
  const points = computeBuscaminasPoints(input.difficulty, input.seconds);
  const entry: BuscaminasScoreEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    difficulty: input.difficulty,
    difficultyLabel: input.difficultyLabel,
    points,
    seconds: Math.max(0, Math.floor(input.seconds)),
    at: new Date().toISOString(),
  };
  const next = [...loadTop5(), entry].sort(compareScores).slice(0, TOP_N);
  saveTop5(next);
  return next;
}
