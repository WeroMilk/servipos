import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode; /** Al cambiar de ruta se limpia el error sin desmontar el árbol (evita flashes en desktop). */
  routePath?: string };

type State = { hasError: boolean; error: Error | null };

/**
 * Evita pantalla en blanco si falla el árbol de una ruta.
 * No usar `key={pathname}` en el boundary: desmontar todo el Outlet en cada navegación provoca flashes/pantalla negra en escritorio.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RouteErrorBoundary:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.routePath !== this.props.routePath && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center">
          <p className="text-sm font-medium text-red-200">Algo salió mal al cargar esta pantalla.</p>
          <p className="max-w-md text-xs text-slate-500">
            Puedes reintentar o usar el menú para ir a otra sección. Si el problema continúa, recarga la página
            (F5).
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Reintentar
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Recargar página
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
