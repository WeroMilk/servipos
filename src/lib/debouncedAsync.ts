/** Agrupa llamadas async frecuentes (p. ej. Realtime) en una sola ejecución tras una pausa. */
export function createDebouncedAsyncFn(fn: () => Promise<void>, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let rerun = false;

  const run = async () => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await fn();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void run();
      }
    }
  };

  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delayMs);
  };
}
