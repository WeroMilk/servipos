import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  children: ReactNode;
  routePath?: string;
};

type State = { hasError: boolean; error: Error | null; routePath: string };

/**
 * Evita pantalla en blanco si falla el árbol de una ruta.
 * Al cambiar `routePath`, se limpia el error en getDerivedStateFromProps (mismo ciclo que la nueva ruta),
 * no solo en componentDidUpdate, para no quedar un frame con el fallo de la pantalla anterior.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      routePath: props.routePath ?? '',
    };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const next = props.routePath ?? '';
    if (next !== state.routePath) {
      return { routePath: next, hasError: false, error: null };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RouteErrorBoundary:', error, info.componentStack);
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
