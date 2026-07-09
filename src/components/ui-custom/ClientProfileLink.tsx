import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type ProfileTab =
  | 'resumen'
  | 'compras'
  | 'facturas'
  | 'cotizaciones'
  | 'adeudos'
  | 'credito';

type ClientProfileLinkProps = {
  clienteId?: string | null;
  nombre?: string | null;
  fallback?: string;
  className?: string;
  tab?: ProfileTab;
  /** Evita que un clic en fila/card dispare otra acción. */
  stopPropagation?: boolean;
};

export function ClientProfileLink({
  clienteId,
  nombre,
  fallback = 'Mostrador',
  className,
  tab,
  stopPropagation = true,
}: ClientProfileLinkProps) {
  const label = nombre?.trim() || fallback;
  const id = (clienteId ?? '').trim();
  if (!id || id === 'mostrador') {
    return <span className={cn('truncate', className)}>{label}</span>;
  }
  const to = tab ? `/clientes/${id}?tab=${tab}` : `/clientes/${id}`;
  return (
    <Link
      to={to}
      className={cn(
        'truncate font-medium text-cyan-800 hover:underline dark:text-cyan-300/90',
        className
      )}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
      }}
    >
      {label}
    </Link>
  );
}
