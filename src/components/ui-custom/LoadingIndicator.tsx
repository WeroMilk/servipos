import { cn } from '@/lib/utils';

export type LoadingIndicatorProps = {
  /** Cadena vacía oculta el texto */
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
  /** En fila (p. ej. botón de envío) */
  inline?: boolean;
  /** Sobre fondos oscuros o gradientes (login) */
  tone?: 'default' | 'onBrand';
  className?: string;
};

const r = 10;
const c = 12;
const circumference = 2 * Math.PI * r;
const dash = Math.round(circumference * 0.2);

function SpinnerRing({
  size,
  onBrand,
}: {
  size: 'sm' | 'md' | 'lg';
  onBrand: boolean;
}) {
  const box =
    size === 'sm' ? 'h-[18px] w-[18px]' : size === 'md' ? 'h-6 w-6' : 'h-8 w-8';
  const sw = size === 'lg' ? 2.5 : 2;

  return (
    <div
      className={cn(
        onBrand ? 'text-white' : 'text-cyan-600 dark:text-cyan-400',
        'motion-safe:animate-spin',
        box
      )}
      style={{ animationDuration: '0.85s' }}
      aria-hidden
    >
      <svg className="h-full w-full" viewBox="0 0 24 24" fill="none">
        <circle
          cx={c}
          cy={c}
          r={r}
          stroke="currentColor"
          strokeWidth={sw}
          className={onBrand ? 'text-white/25' : 'text-slate-300/60 dark:text-slate-600/35'}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={onBrand ? 'text-white' : 'text-cyan-600 dark:text-cyan-400'}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
    </div>
  );
}

/**
 * Spinner y mensaje minimalistas.
 */
export function LoadingIndicator({
  message = 'Cargando',
  size = 'md',
  fullScreen = false,
  inline = false,
  tone = 'default',
  className,
}: LoadingIndicatorProps) {
  const showMessage = message !== '';
  const onBrand = tone === 'onBrand';

  const label = showMessage ? (
    <p
      className={cn(
        'font-medium uppercase tracking-[0.32em] text-slate-600/95 dark:text-slate-500/95',
        size === 'sm' ? 'text-[10px]' : 'text-[11px]',
        onBrand && 'text-white/90'
      )}
    >
      {message}
    </p>
  ) : null;

  const inner = (
    <div
      className={cn(
        'flex items-center',
        inline ? 'flex-row gap-3' : 'flex-col gap-5',
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={showMessage ? message : 'Cargando'}
    >
      <SpinnerRing size={size} onBrand={onBrand} />
      {label}
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className={cn(
          'flex min-h-dvh w-full items-center justify-center',
          'bg-gradient-to-b from-slate-100 via-slate-50 to-cyan-100/30 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/25'
        )}
      >
        {inner}
      </div>
    );
  }

  return inner;
}
