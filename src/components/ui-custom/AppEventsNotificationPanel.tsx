import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuthStore, useNotificationStore, useAppStore } from '@/stores';
import { subscribeAppEvents, deleteAllAppEvents } from '@/lib/firestore/appEventsFirestore';
import type { AppEventLogRecord } from '@/types';
import { cn } from '@/lib/utils';

const EVENTS_LIMIT = 250;

function formatEventTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function kindStyles(k: AppEventLogRecord['kind']): string {
  switch (k) {
    case 'success':
      return 'text-emerald-400/90';
    case 'warning':
      return 'text-amber-400/90';
    case 'error':
      return 'text-red-400/90';
    default:
      return 'text-slate-300';
  }
}

export function AppEventsNotificationPanel() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { eventsLastSeenAtMs, markEventsPanelSeen } = useNotificationStore();
  const { addToast } = useAppStore();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AppEventLogRecord[]>([]);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!user?.id) {
      setEvents([]);
      return;
    }
    return subscribeAppEvents(EVENTS_LIMIT, setEvents);
  }, [user?.id]);

  const latestMs = events[0]?.createdAt.getTime() ?? 0;
  const hasUnread = latestMs > eventsLastSeenAtMs;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) markEventsPanelSeen();
    },
    [markEventsPanelSeen]
  );

  const handleClearAll = useCallback(async () => {
    setClearing(true);
    try {
      const n = await deleteAllAppEvents();
      addToast({
        type: 'success',
        message: `Se eliminaron ${n} registro(s) del historial de eventos.`,
      });
      setClearOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'No se pudo vaciar el historial',
      });
    } finally {
      setClearing(false);
    }
  }, [addToast]);

  const subtitle = useMemo(
    () =>
      events.length >= EVENTS_LIMIT
        ? `Últimos ${EVENTS_LIMIT} eventos (los más recientes).`
        : 'Historial de actividad de todos los usuarios.',
    [events.length]
  );

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative h-10 w-10 rounded-xl bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
            aria-label="Notificaciones y eventos"
          >
            <Bell className="h-5 w-5" />
            {hasUnread ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-slate-950" />
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className={cn(
            'flex h-[min(70dvh,28rem)] max-h-[min(70dvh,28rem)] w-[min(100vw-2rem,26rem)] flex-col overflow-hidden border-slate-800 bg-slate-900 p-0 text-slate-100 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out'
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Eventos del sistema</p>
              <p className="truncate text-[10px] text-slate-500">{subtitle}</p>
            </div>
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 text-xs text-amber-400/90 hover:bg-amber-500/10 hover:text-amber-300"
                onClick={() => setClearOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vaciar
              </Button>
            ) : null}
          </div>
          {/* div intermedio: el <ul> como flex-1 a veces no recibe altura de scroll en Chrome dentro del portal */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]"
            role="region"
            aria-label="Lista de eventos"
          >
            <ul className="m-0 list-none p-0">
              {events.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-slate-500">
                  Aún no hay eventos registrados o no hay permisos de lectura en Firestore (
                  <code className="text-slate-400">appEvents</code>).
                </li>
              ) : (
                events.map((ev) => (
                  <li
                    key={ev.id}
                    className="border-b border-slate-800/60 px-3 py-2.5 last:border-0"
                  >
                    <button
                      type="button"
                      className="w-full text-left transition-colors hover:bg-slate-800/30 rounded-md -mx-1 px-1 py-0.5"
                      onClick={() => {
                        if (ev.route?.startsWith('/')) {
                          navigate(ev.route);
                          setOpen(false);
                        }
                      }}
                      disabled={!ev.route?.startsWith('/')}
                    >
                      <p className={cn('text-xs font-medium', kindStyles(ev.kind))}>{ev.title}</p>
                      {ev.detail ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{ev.detail}</p>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] text-slate-600">
                        {formatEventTime(ev.createdAt)} · {ev.actorName}
                        {ev.actorRole ? ` · ${ev.actorRole}` : ''}
                        {ev.source ? ` · ${ev.source}` : ''}
                      </p>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Vaciar historial de eventos</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Se eliminarán <strong className="text-slate-200">todos</strong> los registros de la
              colección <code className="text-slate-300">appEvents</code> en Firestore. Solo los
              administradores pueden hacerlo. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              onClick={(e) => {
                e.preventDefault();
                void handleClearAll();
              }}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              {clearing ? 'Borrando…' : 'Vaciar todo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
