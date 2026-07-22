import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { resolveUbicacionesProducto } from '@/data/ubicacionesMuebleA';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

/** Contenido reutilizable: estante / mueble del producto. */
export function UbicacionFisicaContent({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const slots = resolveUbicacionesProducto(product);
  return (
    <div className={cn('space-y-2.5 text-sm', className)}>
      <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
        <MapPin className="h-4 w-4 shrink-0 text-brand dark:text-brand" aria-hidden />
        Ubicación física
      </div>
      <p className="font-mono text-xs text-slate-600 dark:text-slate-400">SKU: {product.sku}</p>
      {slots.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          Este producto aún no tiene ubicación física registrada.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((slot) => (
            <Badge
              key={slot}
              className="bg-brand/15 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-brand-to dark:text-brand"
            >
              {slot}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function UbicacionFisicaNombre({
  product,
  variant,
  onOpenDialog,
  className,
  nameClassName,
  pinClassName,
  layout = 'start',
}: {
  product: Product;
  variant: 'popover' | 'dialog';
  onOpenDialog?: (product: Product) => void;
  className?: string;
  nameClassName?: string;
  pinClassName?: string;
  layout?: 'start' | 'center';
}) {
  const trigger = (
    <button
      type="button"
      onClick={variant === 'dialog' ? () => onOpenDialog?.(product) : undefined}
      className={className}
      title="Ver ubicación física"
    >
      <span
        className={cn(
          'flex w-full min-w-0 max-w-full gap-1.5',
          layout === 'center' ? 'items-center' : 'items-start'
        )}
      >
        <span className={cn('min-w-0 flex-1', nameClassName)}>{product.nombre}</span>
        <MapPin className={cn('shrink-0', pinClassName)} aria-hidden />
      </span>
    </button>
  );

  if (variant === 'dialog') {
    return trigger;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 border-slate-200 bg-slate-100 p-3 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <UbicacionFisicaContent product={product} />
      </PopoverContent>
    </Popover>
  );
}
