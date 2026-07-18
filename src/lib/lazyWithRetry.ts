import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RECOVERY_KEY = 'servipos:chunk-recovery';
const MAX_HARD_RECOVERIES = 2;

/** Errores típicos cuando el HTML viejo pide un JS que ya no existe tras un deploy / update del SW. */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const name = error instanceof Error ? error.name : '';
  const stack = error instanceof Error ? error.stack ?? '' : '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /CSS_CHUNK_LOAD_FAILED/i.test(msg) ||
    /Loading CSS chunk [\d]+ failed/i.test(msg) ||
    /Unable to preload CSS/i.test(msg) ||
    (/TypeError/i.test(name) && /fetch|load failed|dynamically imported/i.test(msg)) ||
    (/ChunkLoadError|dynamically imported module/i.test(stack) && /failed/i.test(msg + stack))
  );
}

function recoveryCount(): number {
  try {
    return Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || '0') || 0;
  } catch {
    return 0;
  }
}

function bumpRecoveryCount(): number {
  const next = recoveryCount() + 1;
  try {
    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}

/** Borra caches de PWA y desregistra service workers para forzar assets frescos. */
export async function purgeClientAssetCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Recuperación dura: limpia SW/caché y recarga con cache-bust.
 * Hasta MAX_HARD_RECOVERIES intentos por pestaña para no loopear.
 */
export function reloadOnceForStaleAssets(): boolean {
  const n = recoveryCount();
  if (n >= MAX_HARD_RECOVERIES) return false;
  bumpRecoveryCount();

  void (async () => {
    await purgeClientAssetCaches();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_cb', String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  })();

  return true;
}

/** Alias explícito para callers async. */
export async function recoverFromStaleAssets(): Promise<boolean> {
  if (!reloadOnceForStaleAssets()) return false;
  return true;
}

/**
 * `React.lazy` con recuperación: reintenta import; si el chunk falló (deploy/SW),
 * purga caché y recarga sin mostrar pantalla roja.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  options?: { retries?: number; retryDelayMs?: number }
): LazyExoticComponent<T> {
  const retries = options?.retries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 350;

  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Cache-bust el import en reintentos (evita módulo fallido cacheado en memoria del browser).
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        }
        const mod = await factory();
        clearChunkReloadFlag();
        return mod;
      } catch (error) {
        lastError = error;
        if (isChunkLoadError(error)) {
          if (attempt < retries) continue;
          if (reloadOnceForStaleAssets()) {
            return new Promise(() => {
              /* la página se está recargando */
            });
          }
          throw error;
        }
        if (attempt < retries) continue;
      }
    }
    throw lastError;
  });
}

/** Escucha global: si un import dinámico falla fuera del árbol React, recupera igual. */
export function installChunkLoadRecoveryListeners(): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    reloadOnceForStaleAssets();
  };
  const onError = (event: ErrorEvent) => {
    if (!isChunkLoadError(event.error ?? event.message)) return;
    event.preventDefault();
    reloadOnceForStaleAssets();
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError);
  };
}
