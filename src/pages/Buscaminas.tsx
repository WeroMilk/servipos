import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Bomb, Flag, RotateCcw, Timer } from 'lucide-react';
import { PageShell } from '@/components/ui-custom/PageShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isGabrielUser } from '@/lib/gabrielEasterEgg';
import { useAuthStore } from '@/stores';

type Difficulty = 'beginner' | 'intermediate';

type Cell = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
};

const DIFFICULTY: Record<Difficulty, { rows: number; cols: number; mines: number; label: string }> = {
  beginner: { rows: 9, cols: 9, mines: 10, label: 'Principiante' },
  intermediate: { rows: 16, cols: 16, mines: 40, label: 'Intermedio' },
};

function createEmptyGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    }))
  );
}

function inBounds(r: number, c: number, rows: number, cols: number) {
  return r >= 0 && c >= 0 && r < rows && c < cols;
}

function neighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc, rows, cols)) out.push([nr, nc]);
    }
  }
  return out;
}

function placeMines(
  grid: Cell[][],
  mines: number,
  safeR: number,
  safeC: number
): Cell[][] {
  const rows = grid.length;
  const cols = grid[0]!.length;
  const next = grid.map((row) => row.map((cell) => ({ ...cell })));
  const forbidden = new Set<string>([`${safeR},${safeC}`]);
  for (const [nr, nc] of neighbors(safeR, safeC, rows, cols)) {
    forbidden.add(`${nr},${nc}`);
  }
  let placed = 0;
  let guard = 0;
  while (placed < mines && guard < mines * 200) {
    guard++;
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const key = `${r},${c}`;
    if (forbidden.has(key) || next[r]![c]!.mine) continue;
    next[r]![c]!.mine = true;
    placed++;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (next[r]![c]!.mine) {
        next[r]![c]!.adjacent = 0;
        continue;
      }
      next[r]![c]!.adjacent = neighbors(r, c, rows, cols).filter(
        ([nr, nc]) => next[nr]![nc]!.mine
      ).length;
    }
  }
  return next;
}

function floodReveal(grid: Cell[][], startR: number, startC: number): Cell[][] {
  const rows = grid.length;
  const cols = grid[0]!.length;
  const next = grid.map((row) => row.map((cell) => ({ ...cell })));
  const stack: [number, number][] = [[startR, startC]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const cell = next[r]![c]!;
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.mine || cell.adjacent > 0) continue;
    for (const [nr, nc] of neighbors(r, c, rows, cols)) {
      if (!next[nr]![nc]!.revealed && !next[nr]![nc]!.flagged) {
        stack.push([nr, nc]);
      }
    }
  }
  return next;
}

function checkWin(grid: Cell[][]): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (!cell.mine && !cell.revealed) return false;
    }
  }
  return true;
}

const ADJACENT_COLOR: Record<number, string> = {
  1: 'text-blue-600 dark:text-blue-400',
  2: 'text-emerald-600 dark:text-emerald-400',
  3: 'text-red-600 dark:text-red-400',
  4: 'text-indigo-700 dark:text-indigo-300',
  5: 'text-amber-800 dark:text-amber-400',
  6: 'text-cyan-700 dark:text-cyan-300',
  7: 'text-slate-900 dark:text-slate-100',
  8: 'text-slate-500 dark:text-slate-400',
};

export function Buscaminas() {
  const user = useAuthStore((s) => s.user);

  if (!isGabrielUser(user)) {
    return <Navigate to="/" replace />;
  }

  return <BuscaminasGame />;
}

function BuscaminasGame() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const cfg = DIFFICULTY[difficulty];
  const [grid, setGrid] = useState(() => createEmptyGrid(cfg.rows, cfg.cols));
  const [minesPlaced, setMinesPlaced] = useState(false);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [seconds, setSeconds] = useState(0);
  const [timerOn, setTimerOn] = useState(false);
  const longPressRef = useRef<{ r: number; c: number; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );
  const flagGestureRef = useRef(false);

  const reset = useCallback((diff: Difficulty = difficulty) => {
    const d = DIFFICULTY[diff];
    setDifficulty(diff);
    setGrid(createEmptyGrid(d.rows, d.cols));
    setMinesPlaced(false);
    setStatus('playing');
    setSeconds(0);
    setTimerOn(false);
  }, [difficulty]);

  useEffect(() => {
    if (!timerOn || status !== 'playing') return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [timerOn, status]);

  const flags = useMemo(
    () => grid.reduce((acc, row) => acc + row.filter((c) => c.flagged).length, 0),
    [grid]
  );
  const minesLeft = Math.max(0, cfg.mines - flags);

  const reveal = useCallback(
    (r: number, c: number) => {
      if (status !== 'playing') return;
      setGrid((prev) => {
        let g = prev;
        if (!minesPlaced) {
          g = placeMines(prev, cfg.mines, r, c);
        }
        const cell = g[r]![c]!;
        if (cell.revealed || cell.flagged) return prev;
        if (cell.mine) {
          const blown = g.map((row) =>
            row.map((cell2) => (cell2.mine ? { ...cell2, revealed: true } : { ...cell2 }))
          );
          blown[r]![c] = { ...blown[r]![c]!, revealed: true };
          return blown;
        }
        return floodReveal(g, r, c);
      });
      if (!minesPlaced) {
        setMinesPlaced(true);
        setTimerOn(true);
      }
    },
    [status, minesPlaced, cfg.mines]
  );

  useEffect(() => {
    if (status !== 'playing' || !minesPlaced) return;
    if (grid.some((row) => row.some((cell) => cell.mine && cell.revealed && !cell.flagged))) {
      // lost: mine revealed
      const lost = grid.some((row) =>
        row.some((cell) => cell.mine && cell.revealed)
      );
      if (lost && grid.flat().some((c) => c.mine && c.revealed)) {
        const anyBlown = grid.some((row) => row.some((c) => c.mine && c.revealed));
        if (anyBlown) {
          // Detect win/loss after grid update
        }
      }
    }
    const hitMine = grid.some((row) => row.some((c) => c.mine && c.revealed));
    if (hitMine) {
      setStatus('lost');
      setTimerOn(false);
      return;
    }
    if (checkWin(grid)) {
      setStatus('won');
      setTimerOn(false);
    }
  }, [grid, minesPlaced, status]);

  const toggleFlag = useCallback(
    (r: number, c: number) => {
      if (status !== 'playing') return;
      setGrid((prev) => {
        const cell = prev[r]![c]!;
        if (cell.revealed) return prev;
        if (!minesPlaced) {
          setMinesPlaced(true);
          setTimerOn(true);
          // Place mines away from this cell so flagging first is ok
          const withMines = placeMines(prev, cfg.mines, r, c);
          return withMines.map((row, ri) =>
            row.map((cell2, ci) =>
              ri === r && ci === c ? { ...cell2, flagged: !cell2.flagged } : cell2
            )
          );
        }
        return prev.map((row, ri) =>
          row.map((cell2, ci) =>
            ri === r && ci === c ? { ...cell2, flagged: !cell2.flagged } : cell2
          )
        );
      });
    },
    [status, minesPlaced, cfg.mines]
  );

  const onContextMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    toggleFlag(r, c);
  };

  const onPointerDown = (r: number, c: number) => {
    flagGestureRef.current = false;
    if (longPressRef.current) clearTimeout(longPressRef.current.timer);
    longPressRef.current = {
      r,
      c,
      timer: setTimeout(() => {
        flagGestureRef.current = true;
        toggleFlag(r, c);
        longPressRef.current = null;
      }, 450),
    };
  };

  const onPointerUp = (r: number, c: number) => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    if (flagGestureRef.current) {
      flagGestureRef.current = false;
      return;
    }
    reveal(r, c);
  };

  const onPointerLeave = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const statusLabel =
    status === 'won' ? '¡Ganaste!' : status === 'lost' ? 'Boom… perdiste' : 'Jugando';

  const cellSize =
    difficulty === 'beginner'
      ? 'h-9 w-9 text-sm sm:h-10 sm:w-10'
      : 'h-6 w-6 text-[10px] sm:h-7 sm:w-7 sm:text-xs';

  return (
    <PageShell
      title="Buscaminas"
      subtitle="Easter egg · solo tú puedes ver esto"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={difficulty === d ? 'default' : 'outline'}
              onClick={() => reset(d)}
            >
              {DIFFICULTY[d].label}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => reset()}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reiniciar
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5 dark:border-slate-800/50 dark:bg-slate-900/50">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
            <Bomb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {minesLeft}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
            <Timer className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            {String(Math.min(seconds, 999)).padStart(3, '0')}
          </span>
          <span
            className={cn(
              'text-sm font-medium',
              status === 'won' && 'text-emerald-600 dark:text-emerald-400',
              status === 'lost' && 'text-red-600 dark:text-red-400',
              status === 'playing' && 'text-slate-600 dark:text-slate-400'
            )}
          >
            {statusLabel}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-500">
            Clic = abrir · clic derecho / mantener = bandera
          </span>
        </div>

        <div className="flex justify-center overflow-x-auto">
          <div
            className="inline-grid gap-0.5 rounded-xl border border-slate-300/80 bg-slate-200/60 p-1.5 dark:border-slate-700 dark:bg-slate-900/80"
            style={{ gridTemplateColumns: `repeat(${cfg.cols}, minmax(0, 1fr))` }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {grid.map((row, r) =>
              row.map((cell, c) => {
                const showMine = cell.revealed && cell.mine;
                const showNum = cell.revealed && !cell.mine && cell.adjacent > 0;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    disabled={status !== 'playing' && !cell.revealed}
                    onContextMenu={(e) => onContextMenu(e, r, c)}
                    onPointerDown={() => onPointerDown(r, c)}
                    onPointerUp={() => onPointerUp(r, c)}
                    onPointerLeave={onPointerLeave}
                    onPointerCancel={onPointerLeave}
                    className={cn(
                      'flex select-none items-center justify-center rounded-sm font-bold tabular-nums transition-colors',
                      cellSize,
                      cell.revealed
                        ? 'bg-slate-100 dark:bg-slate-800/90'
                        : 'bg-slate-300/90 shadow-sm hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600',
                      showMine && 'bg-red-500/90 text-white',
                      cell.flagged && !cell.revealed && 'bg-amber-200/90 dark:bg-amber-900/50'
                    )}
                    aria-label={
                      cell.flagged
                        ? 'Bandera'
                        : cell.revealed
                          ? cell.mine
                            ? 'Mina'
                            : String(cell.adjacent)
                          : 'Celda cerrada'
                    }
                  >
                    {cell.flagged && !cell.revealed ? (
                      <Flag className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                    ) : showMine ? (
                      <Bomb className="h-3.5 w-3.5" />
                    ) : showNum ? (
                      <span className={ADJACENT_COLOR[cell.adjacent]}>{cell.adjacent}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
