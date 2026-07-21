import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ACCENT_COLORS, useAppStore } from '@/stores';
import type { AccentColor } from '@/types';
import { cn } from '@/lib/utils';

const ACCENT_LABELS: Record<AccentColor, string> = {
  blue: 'Azul',
  sky: 'Cielo',
  teal: 'Verde azulado',
  emerald: 'Esmeralda',
  green: 'Verde',
  lime: 'Lima',
  amber: 'Ámbar',
  orange: 'Naranja',
  rose: 'Rosa',
  pink: 'Fucsia',
  violet: 'Violeta',
  indigo: 'Índigo',
};

/** Swatch preview colors (match CSS palettes). */
const ACCENT_SWATCH: Record<AccentColor, string> = {
  blue: 'hsl(217 91% 60%)',
  sky: 'hsl(199 89% 48%)',
  teal: 'hsl(173 80% 40%)',
  emerald: 'hsl(160 84% 39%)',
  green: 'hsl(142 71% 45%)',
  lime: 'hsl(84 81% 44%)',
  amber: 'hsl(38 92% 50%)',
  orange: 'hsl(25 95% 53%)',
  rose: 'hsl(350 89% 60%)',
  pink: 'hsl(330 81% 60%)',
  violet: 'hsl(258 90% 66%)',
  indigo: 'hsl(239 84% 67%)',
};

const triggerClassName =
  'h-10 w-10 shrink-0 rounded-xl bg-slate-200/80 text-slate-700 hover:bg-slate-300/80 hover:text-slate-900 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100';

type AccentColorPickerProps = {
  /** Extra classes for the trigger button. */
  className?: string;
  /** Align popover relative to trigger. */
  align?: 'start' | 'center' | 'end';
};

export function AccentColorPicker({ className, align = 'end' }: AccentColorPickerProps) {
  const accentColor = useAppStore((s) => s.accentColor);
  const setAccentColor = useAppStore((s) => s.setAccentColor);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(triggerClassName, className)}
          aria-label="Color de marca"
          title="Color de marca"
        >
          <Palette className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[220px] p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Color de marca</p>
        <div className="grid grid-cols-4 gap-2">
          {ACCENT_COLORS.map((color) => {
            const active = accentColor === color;
            return (
              <button
                key={color}
                type="button"
                title={ACCENT_LABELS[color]}
                aria-label={ACCENT_LABELS[color]}
                aria-pressed={active}
                onClick={() => setAccentColor(color)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                  active && 'ring-2 ring-offset-2 ring-offset-popover ring-brand'
                )}
              >
                <span
                  className="h-7 w-7 rounded-full shadow-sm"
                  style={{ backgroundColor: ACCENT_SWATCH[color] }}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
