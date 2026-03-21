import { useEffect, useMemo, useState } from 'react';
import {
  endOfMonth,
  endOfWeek,
  format,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export type PeriodGranularity = 'day' | 'week' | 'month';

type Props = {
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  granularity: PeriodGranularity;
  onGranularityChange: (g: PeriodGranularity) => void;
  rangeLabel: string;
  trigger: React.ReactNode;
};

function dayInSelectedSpan(day: Date, range: DateRange | undefined): boolean {
  if (!range?.from || !range?.to) return false;
  const a = startOfDay(range.from);
  const b = startOfDay(range.to);
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  const endInclusive = new Date(end);
  endInclusive.setHours(23, 59, 59, 999);
  try {
    return isWithinInterval(startOfDay(day), { start, end: endInclusive });
  } catch {
    return false;
  }
}

/**
 * Calendario del panel: día / semana / mes (estilo cercano a Google Calendar, tema oscuro).
 * react-day-picker v9: onSelect(selected, triggerDate, …) — el primer argumento es la fecha elegida.
 */
export function DashboardPeriodPopover({
  dateRange,
  onDateRangeChange,
  open,
  onOpenChange,
  granularity,
  onGranularityChange,
  rangeLabel,
  trigger,
}: Props) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));

  useEffect(() => {
    if (open) {
      const ref = dateRange?.from ?? new Date();
      setMonth(startOfMonth(ref));
    }
  }, [open, dateRange?.from]);

  const modifiers = useMemo(
    () => ({
      in_span: (d: Date) => dayInSelectedSpan(d, dateRange),
    }),
    [dateRange]
  );

  const selectedDay = dateRange?.from;

  const applySelection = (raw: Date) => {
    const d = startOfDay(raw);
    if (granularity === 'day') {
      onDateRangeChange({ from: d, to: d });
    } else if (granularity === 'week') {
      onDateRangeChange({
        from: startOfWeek(d, { weekStartsOn: 1 }),
        to: endOfWeek(d, { weekStartsOn: 1 }),
      });
    } else {
      onDateRangeChange({
        from: startOfMonth(d),
        to: endOfMonth(d),
      });
    }
  };

  const hint = useMemo(() => {
    if (granularity === 'day') return 'Elige un día';
    if (granularity === 'week') return 'Elige un día: se selecciona la semana (lun–dom)';
    return 'Elige un día del mes que quieras analizar';
  }, [granularity]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          'w-[min(calc(100vw-1.5rem),20.5rem)] overflow-hidden border border-slate-700/80 bg-[#2d2d2d] p-0 text-slate-100 shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out'
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-slate-600/50 bg-[#353535] px-3 py-2.5">
          <p className="text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Periodo del resumen
          </p>
          <ToggleGroup
            type="single"
            value={granularity}
            onValueChange={(v) => {
              if (v === 'day' || v === 'week' || v === 'month') onGranularityChange(v);
            }}
            variant="outline"
            size="sm"
            className="mt-2 grid w-full grid-cols-3 gap-1 rounded-lg bg-[#2d2d2d] p-1"
          >
            <ToggleGroupItem
              value="day"
              aria-label="Por día"
              className={cn(
                'h-8 flex-1 rounded-md border-0 text-xs font-medium text-slate-300',
                'data-[state=on]:bg-[#1a73e8] data-[state=on]:text-white data-[state=on]:shadow-sm',
                'hover:bg-slate-600/50 hover:text-white data-[state=on]:hover:bg-[#1967d2]'
              )}
            >
              Día
            </ToggleGroupItem>
            <ToggleGroupItem
              value="week"
              aria-label="Por semana"
              className={cn(
                'h-8 flex-1 rounded-md border-0 text-xs font-medium text-slate-300',
                'data-[state=on]:bg-[#1a73e8] data-[state=on]:text-white data-[state=on]:shadow-sm',
                'hover:bg-slate-600/50 hover:text-white data-[state=on]:hover:bg-[#1967d2]'
              )}
            >
              Semana
            </ToggleGroupItem>
            <ToggleGroupItem
              value="month"
              aria-label="Por mes"
              className={cn(
                'h-8 flex-1 rounded-md border-0 text-xs font-medium text-slate-300',
                'data-[state=on]:bg-[#1a73e8] data-[state=on]:text-white data-[state=on]:shadow-sm',
                'hover:bg-slate-600/50 hover:text-white data-[state=on]:hover:bg-[#1967d2]'
              )}
            >
              Mes
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-center text-[11px] leading-snug text-slate-500">{hint}</p>
        </div>

        <div className="px-2 pb-1 pt-2">
          <Calendar
            locale={es}
            weekStartsOn={1}
            mode="single"
            month={month}
            onMonthChange={setMonth}
            selected={selectedDay}
            onSelect={(date) => {
              if (date) applySelection(date);
            }}
            modifiers={modifiers}
            modifiersClassNames={{
              in_span: 'bg-[#1a73e8]/35 text-slate-50',
            }}
            className="w-full rounded-none bg-transparent p-0 [--cell-size:2.25rem]"
            classNames={{
              root: 'w-full',
              months: 'w-full flex flex-col',
              month: 'relative w-full flex flex-col gap-2 px-1',
              nav: 'absolute inset-x-1 top-0 z-10 flex w-auto items-center justify-between',
              button_previous: cn(
                'size-9 rounded-full border-0 bg-transparent text-slate-300',
                'hover:bg-slate-600/60 hover:text-white',
                'aria-disabled:opacity-30'
              ),
              button_next: cn(
                'size-9 rounded-full border-0 bg-transparent text-slate-300',
                'hover:bg-slate-600/60 hover:text-white',
                'aria-disabled:opacity-30'
              ),
              month_caption:
                'relative z-0 mb-1 flex min-h-[2.75rem] items-center justify-center pt-10',
              caption_label: 'text-sm font-medium text-slate-100 select-none',
              weekdays: 'mb-1 flex w-full px-0.5',
              weekday: cn(
                'flex-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500',
                'select-none'
              ),
              week: 'mt-0 flex w-full',
              day: cn(
                'relative flex h-9 flex-1 items-center justify-center p-0 text-center',
                'focus-within:relative focus-within:z-20'
              ),
              today: 'text-[#8ab4f8]',
              outside: 'text-slate-600 opacity-40',
              disabled: 'text-slate-600 opacity-25',
            }}
            formatters={{
              formatCaption: (date) => format(date, 'MMMM yyyy', { locale: es }),
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-600/50 bg-[#353535] px-3 py-2">
          <p className="min-w-0 truncate text-xs text-slate-400" title={rangeLabel}>
            {rangeLabel}
          </p>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 bg-[#1a73e8] px-4 text-xs font-medium text-white hover:bg-[#1967d2]"
            onClick={() => onOpenChange(false)}
          >
            Listo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
