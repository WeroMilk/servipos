// Toast Container Component
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '@/lib/utils';

/** Por encima de diálogos (≈241), sheets (181) y popovers del POS (300). */
const TOAST_LAYER_Z = 'z-[9999]';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  warning:
    'bg-amber-500/10 border-amber-500/30 text-black dark:border-amber-500/40 dark:text-amber-100',
  info: 'bg-brand/10 border-brand/30 text-brand-to dark:text-brand',
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed flex flex-col gap-3',
        TOAST_LAYER_Z,
        'max-w-[min(100vw-2rem,24rem)]',
        /* Móvil: bajo el header (h-14 / sm:h-16), esquina superior derecha */
        'max-md:bottom-auto max-md:left-auto max-md:items-end',
        'max-sm:top-[calc(3.5rem+0.375rem+env(safe-area-inset-top,0px))]',
        'sm:max-md:top-[calc(4rem+0.375rem+env(safe-area-inset-top,0px))]',
        'max-md:right-[max(0.75rem,env(safe-area-inset-right,0px))]',
        /* Tablet/desktop: abajo a la izquierda */
        'md:top-auto md:right-auto md:items-start md:left-[max(0.75rem,env(safe-area-inset-left,0px))]',
        'md:bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))]',
        toasts.length === 0 && 'pointer-events-none'
      )}
      aria-live="polite"
    >
      {toasts.map((toast, index) => {
        const Icon = iconMap[toast.type];
        
        return (
          <div
            key={toast.id}
            className={cn(
              'flex w-full min-w-0 items-center gap-3 rounded-xl border border-slate-200/90 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-transparent dark:bg-slate-950/85',
              'shadow-lg transform transition-all duration-300',
              'max-md:animate-slideInRight md:animate-slideInLeft',
              colorMap[toast.type]
            )}
            style={{
              animationDelay: `${index * 50}ms`,
            }}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 rounded-lg p-1 transition-colors hover:bg-slate-200/80 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
