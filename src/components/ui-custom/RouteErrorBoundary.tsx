import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
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
  autoRetryUsed: boolean;
};

/** Fallos de reconciliación DOM (p. ej. portales + React 19) que no indican fallo lógico de la ruta. */
function isTransientDomGlitch(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /removeChild|insertBefore|appendChild|NotFoundError/i.test(msg) &&
    (/not a child of this node/i.test(msg) || /The node to be removed is not a child/i.test(msg))
  );
}

function isRecoverableRenderError(error: unknown): boolean {
  return isChunkLoadError(error) || isTransientDomGlitch(error);
}

/**
 * Evita pantalla en blanco / roja si falla el árbol de una ruta.
 * - Chunks viejos tras deploy: recarga automática una vez.
 * - Glitches DOM: remount limpio sin pedir F5 al usuario.
 * Al cambiar `routePath`, se limpia el error en getDerivedStateFromProps.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  private autoRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      routePath: props.routePath ?? '',
      remountKey: 0,
      autoRetryUsed: false,
    };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const next = props.routePath ?? '';
    if (next !== state.routePath) {
      return {
        routePath: next,
        hasError: false,
        error: null,
        autoRetryUsed: false,
      };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> | null {
    if (isChunkLoadError(error)) {
      // La recarga se dispara en componentDidCatch; aquí evitamos pintar rojo un frame.
      return { hasError: false, error: null };
    }
    if (isTransientDomGlitch(error)) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      if (reloadOnceForStaleAssets()) return;
      // Ya se recargó una vez en esta pestaña: mostrar UI de reintento.
      this.setState((s) => ({
        hasError: true,
        error,
        remountKey: s.remountKey + 1,
      }));
      return;
    }

    if (isTransientDomGlitch(error)) {
      // Remount limpio en el siguiente tick (evita quedar con el árbol a medias).
      this.scheduleSoftRemount();
      return;
    }

    console.error('RouteErrorBoundary:', error, info.componentStack);
  }

  componentWillUnmount() {
    if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
  }

  private scheduleSoftRemount(markAutoRetry = false) {
    if (this.autoRetryTimer) clearTimeout(this.autoRetryTimer);
    this.autoRetryTimer = setTimeout(() => {
      this.setState((s) => ({
        hasError: false,
        error: null,
        remountKey: s.remountKey + 1,
        autoRetryUsed: markAutoRetry ? true : s.autoRetryUsed,
      }));
    }, 50);
  }

  private handleRetry = () => {
    clearChunkReloadFlag();
    this.setState((s) => ({
      hasError: false,
      error: null,
      remountKey: s.remountKey + 1,
      autoRetryUsed: false,
    }));
  };

  private handleReload = () => {
    clearChunkReloadFlag();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const recoverable = isRecoverableRenderError(this.state.error);
      return (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-red-500/30 bg-red-100/80 p-6 text-center dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            Algo salió mal al cargar esta pantalla.
          </p>
          {import.meta.env.DEV && this.state.error ? (
            <p className="max-w-lg break-words rounded-md border border-red-500/20 bg-red-50/80 px-2 py-1.5 text-left font-mono text-[11px] text-red-900 dark:bg-red-950/40 dark:text-red-100">
              {this.state.error.message}
            </p>
          ) : null}
          <p className="max-w-md text-xs text-slate-600 dark:text-slate-500">
            {recoverable
              ? 'Hubo un fallo temporal al cargar. Prueba «Reintentar»; si no vuelve, recarga la página.'
              : 'Puedes reintentar o usar el menú para ir a otra sección.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" onClick={this.handleRetry}>
              Reintentar
            </Button>
            <Button type="button" variant="outline" onClick={this.handleReload}>
              Recargar página
            </Button>
          </div>
        </div>
      );
    }
    return <div key={this.state.remountKey} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{this.props.children}</div>;
  }
}
