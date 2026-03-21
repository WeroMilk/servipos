// Toast Container Component
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '@/lib/utils';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  info: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  return (
    <div
      className={cn(
        'fixed z-[100] flex flex-col gap-3',
        'bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))]',
        'right-[max(1.25rem,env(safe-area-inset-right,0px))]',
        'max-w-[min(100vw-2rem,24rem)]',
        'max-md:bottom-auto max-md:left-auto max-md:right-[max(0.75rem,env(safe-area-inset-right,0px))] max-md:top-[calc(3.5rem+env(safe-area-inset-top,0px))] max-md:items-end',
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
              'ml-6 flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl',
              'shadow-lg transform transition-all duration-300',
              'animate-slideInRight',
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
              className="ml-2 p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
