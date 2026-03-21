import { cn } from '@/lib/utils';

type PageShellProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Contenido bajo el encabezado: debe usar flex-1 min-h-0 para repartir altura */
  children: React.ReactNode;
  className?: string;
};

/**
 * Contenedor de página: ocupa todo el alto del main sin provocar scroll del documento.
 * Aprovecha el ancho (w-full) con paddings controlados desde Layout.
 */
export function PageShell({ title, subtitle, actions, children, className }: PageShellProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 max-w-none flex-col gap-2 overflow-hidden sm:gap-3',
        className
      )}
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-slate-200/80 pb-2 dark:border-slate-800/40 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl lg:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-slate-600 dark:text-slate-500 sm:text-sm">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
