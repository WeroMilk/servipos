import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY = 'servipos:chunk-reload';

/** Errores típicos cuando el HTML viejo pide un JS que ya no existe tras un deploy / update del SW. */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /CSS_CHUNK_LOAD_FAILED/i.test(msg)
  );
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Recarga la página una sola vez por pestaña para recuperar assets nuevos.
 * Evita bucles infinitos si el fallo no era por caché.
 */
export function reloadOnceForStaleAssets(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch {
    /* sessionStorage puede fallar en modo privado estricto */
  }
  window.location.reload();
  return true;
}

/**
 * `React.lazy` con recuperación: si el chunk falló (deploy/SW), recarga una vez;
 * si es un fallo de red momentáneo, reintenta el import.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  options?: { retries?: number; retryDelayMs?: number }
): LazyExoticComponent<T> {
  const retries = options?.retries ?? 2;
  const retryDelayMs = options?.retryDelayMs ?? 400;

  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory();
        clearChunkReloadFlag();
        return mod;
      } catch (error) {
        lastError = error;
        if (isChunkLoadError(error)) {
          // Los imports fallidos suelen quedar cacheados: recargar es la solución fiable.
          if (reloadOnceForStaleAssets()) {
            return new Promise(() => {
              /* la página se está recargando */
            });
          }
          throw error;
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
        }
      }
    }
    throw lastError;
  });
}
