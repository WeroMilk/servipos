import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingIndicator } from '@/components/ui-custom/LoadingIndicator';
import {
  clearChunkReloadFlag,
  isChunkLoadError,
  reloadOnceForStaleAssets,
} from '@/lib/lazyWithRetry';

type Props = {
  children: ReactNode;
  routePath?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
  routePath: string;
  /** Fuerza remount limpio de la ruta tras un fallo recuperable. */
  remountKey: number;
  softRetries: number;
  hardAutoRetries: number;
  recovering: boolean;
};

const MAX_SOFT_RETRIES = 2;

/** Fallos de reconciliación DOM (p. ej. portales + React 19) que no indican fallo lógico de la ruta. */
function isTransientDomGlitch(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /removeChild|insertBefore|appendChild|NotFoundError/i.test(msg) &&
    (/not a child of this node/i.test(msg) || /The node to be removed is not a child/i.test(msg))
  );
}

function isLikelyTransientRouteError(error: unknown): boolean {
  if (isChunkLoadError(error) || isTransientDomGlitch(error)) return true;
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /Minified React error/i.test(msg);
}

/**
 * Evita pantalla en blanco / roja si falla el árbol de una ruta.
 * - Chunks viejos tras deploy: purga caché + recarga automática.
 * - Glitches DOM / fallos momentáneos: remount limpio sin pedir F5.
 * Solo muestra UI de error si agotó recuperaciones automáticas.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  private autoRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private hardFailTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      routePath: props.routePath ?? '',
      remountKey: 0,
      softRetries: 0,
      hardAutoRetries: 0,
      recovering: false,
    };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const next = props.routePath ?? '';
    if (next !== state.routePath) {
      return {
        routePath: next,
        hasError: false,
        error: null,
        softRetries: 0,
        hardAutoRetries: 0,
        recovering: false,
      };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // No pintar rojo de inmediato: componentDidCatch intenta recuperar.
    if (isChunkLoadError(error) || isTransientDomGlitch(error) || isLikelyTransientRouteError(error)) {
      return { hasError: false, error, recovering: true };
    }
    return { hasError: false, error, recovering: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      if (reloadOnceForStaleAssets()) return;
      // Agotó recargas duras: remount suave y, si falla otra vez, UI mínima.
      this.scheduleSoftRemount(true);
      return;
    }

    if (this.state.softRetries < MAX_SOFT_RETRIES) {
      this.scheduleSoftRemount(true);
      return;
    }

    console.error('RouteErrorBoundary:', error, info.componentStack);
    this.setState({ hasError: true, recovering: false, error });
    // Último recurso: reintento automático limitado (sin pedir F5).
    if (this.state.hardAutoRetries >= 2) return;
    if (this.hardFailTimer) clearTimeout(this.hardFailTimer);
    this.hardFailTimer = setTimeout(() => {
      clearChunkReloadFlag();
      this.setState((s) => ({
        hasError: false,
        error: null,
        recovering: false,
        softRetries: 0,
        hardAutoRetries: s.hardAutoRetries + 1,
        remountKey: s.remountKey + 1,
      }));
    }, 1600);
  }

  componentWillUnmount() {
    if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
    if (this.hardFailTimer) clearTimeout(this.hardFailTimer);
  }

  private scheduleSoftRemount(countRetry = false) {
    if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
    this.autoRetryTimer = setTimeout(() => {
      this.setState((s) => ({
        hasError: false,
        error: null,
        recovering: false,
        remountKey: s.remountKey + 1,
        softRetries: countRetry ? s.softRetries + 1 : s.softRetries,
      }));
    }, 40);
  }

  private handleRetry = () => {
    clearChunkReloadFlag();
    if (this.hardFailTimer) clearTimeout(this.hardFailTimer);
    this.setState((s) => ({
      hasError: false,
      error: null,
      recovering: false,
      remountKey: s.remountKey + 1,
      softRetries: 0,
      hardAutoRetries: 0,
    }));
  };

  private handleReload = () => {
    clearChunkReloadFlag();
    reloadOnceForStaleAssets();
    // Si ya no puede recuperar con purge, fuerza reload simple.
    window.setTimeout(() => window.location.reload(), 100);
  };

  render() {
    if (this.state.recovering && !this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center">
          <LoadingIndicator inline message="Recuperando pantalla…" tone="onBrand" />
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-slate-200/80 bg-slate-50/90 p-6 text-center dark:border-slate-800/60 dark:bg-slate-900/50">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            Reintentando cargar esta pantalla…
          </p>
          {import.meta.env.DEV && this.state.error ? (
            <p className="max-w-lg break-words rounded-md border border-slate-200/80 bg-white/80 px-2 py-1.5 text-left font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
              {this.state.error.message}
            </p>
          ) : null}
          <p className="max-w-md text-xs text-slate-600 dark:text-slate-400">
            Si tarda, usa Reintentar. No hace falta pulsar F5.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" onClick={this.handleRetry}>
              Reintentar
            </Button>
            <Button type="button" variant="outline" onClick={this.handleReload}>
              Recargar limpio
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div key={this.state.remountKey} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
        {this.props.children}
      </div>
    );
  }
}
