import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, Lock, Moon, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore, useAppStore, getResolvedIsDark } from '@/stores';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_SRCSET, BRAND_LOGO_URL } from '@/lib/branding';
import { normalizeServipartzEmail, SERVIPARTZ_LOGIN_USERNAMES } from '@/lib/servipartzAuth';
import { fetchLoginDirectoryUsers, type LoginDirectoryUser } from '@/lib/firestore/usersDirectoryFirestore';
import { LoadingIndicator } from './LoadingIndicator';

const MAX_PIN_LEN = 12;

function PinKeypadGrid({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const append = (d: string) => {
    if (disabled || value.length >= MAX_PIN_LEN) return;
    onChange(value + d);
  };
  const backspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };
  const clear = () => {
    if (disabled) return;
    onChange('');
  };

  const cellClass =
    'flex h-11 select-none items-center justify-center rounded-lg border border-slate-400/80 bg-gradient-to-b from-slate-200 to-slate-300 text-lg font-semibold text-slate-900 shadow-sm active:translate-y-px dark:border-slate-600 dark:from-slate-700 dark:to-slate-800 dark:text-slate-100 sm:h-12 sm:text-xl';

  const keys: { label: string; onClick: () => void; className?: string }[] = [
    { label: '1', onClick: () => append('1') },
    { label: '2', onClick: () => append('2') },
    { label: '3', onClick: () => append('3') },
    { label: '4', onClick: () => append('4') },
    { label: '5', onClick: () => append('5') },
    { label: '6', onClick: () => append('6') },
    { label: '7', onClick: () => append('7') },
    { label: '8', onClick: () => append('8') },
    { label: '9', onClick: () => append('9') },
    {
      label: 'C',
      onClick: clear,
      className: 'text-sm font-bold text-amber-700 dark:text-amber-400',
    },
    { label: '0', onClick: () => append('0') },
    {
      label: '',
      onClick: backspace,
      className: 'text-slate-600 dark:text-slate-300',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 pt-1">
      {keys.map((k, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={k.onClick}
          className={cn(cellClass, k.className, disabled && 'pointer-events-none opacity-45')}
        >
          {i === keys.length - 1 ? <Delete className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} /> : k.label}
        </button>
      ))}
    </div>
  );
}

export function LoginForm() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { addToast } = useAppStore();
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const resolvedDark = useAppStore((s) => getResolvedIsDark(s));

  const [directory, setDirectory] = useState<LoginDirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchLoginDirectoryUsers();
      if (cancelled) return;
      if (list.length === 0) {
        setDirectory(
          SERVIPARTZ_LOGIN_USERNAMES.map((u) => ({
            id: `fallback-${u}`,
            name: u.charAt(0).toUpperCase() + u.slice(1),
            email: normalizeServipartzEmail(u),
          }))
        );
      } else {
        setDirectory(list);
      }
      setDirectoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelByEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of directory) {
      const n = (u.name ?? '').trim();
      const count = directory.filter((x) => (x.name ?? '').trim() === n).length;
      m.set(u.email, count > 1 ? `${n} · ${u.email}` : n || u.email);
    }
    return m;
  }, [directory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedEmail?.trim() || !pin) {
      addToast({
        type: 'error',
        message: 'Seleccione usuario e ingrese la clave numérica',
      });
      return;
    }

    setLoading(true);

    try {
      const success = await login(selectedEmail.trim(), pin);

      if (success) {
        addToast({
          type: 'success',
          message: 'Bienvenido al sistema',
        });
        navigate('/');
      } else {
        addToast({
          type: 'error',
          message: 'Usuario o clave incorrectos',
        });
      }
    } catch {
      addToast({
        type: 'error',
        message: 'Error al iniciar sesión',
      });
    } finally {
      setLoading(false);
    }
  };

  const formBusy = loading || directoryLoading;

  return (
    <div
      className={cn(
        'fixed inset-0 z-0 flex min-h-dvh w-full flex-col items-center overflow-y-auto overflow-x-hidden',
        'justify-start px-4 pb-10 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+20dvh))]',
        'sm:justify-center sm:px-8 sm:py-8 sm:pb-8 sm:pt-8'
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-20 h-10 w-10 rounded-xl bg-white/80 text-slate-700 shadow-sm backdrop-blur-md hover:bg-white dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800"
        onClick={() => toggleTheme()}
        aria-label={resolvedDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      >
        {resolvedDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-100 via-white to-slate-100 dark:from-black dark:via-slate-950 dark:to-slate-950"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-slate-200/40 dark:bg-black/55"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-1/4 top-0 h-[min(100dvh,56rem)] w-[min(140vw,56rem)] rounded-full bg-cyan-500/20 blur-3xl dark:bg-cyan-600/10" />
        <div className="absolute -right-1/4 bottom-0 h-[min(100dvh,52rem)] w-[min(130vw,52rem)] rounded-full bg-blue-500/15 blur-3xl dark:bg-blue-600/10" />
        <div className="absolute left-1/2 top-1/2 h-[min(90dvh,40rem)] w-[min(90vw,40rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-900/15" />
      </div>

      <div className="relative z-10 w-full min-w-0 max-w-md">
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 opacity-25 blur" />

        <div
          className={cn(
            'relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-2xl backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/90 sm:p-7',
            'max-sm:max-h-none max-sm:overflow-visible'
          )}
        >
          <div className="mb-5 flex flex-col items-center sm:mb-6">
            <div className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-cyan-500/15 ring-1 ring-slate-300/80 dark:shadow-cyan-500/20 dark:ring-slate-700/50 sm:mb-4 sm:h-24 sm:w-24">
              <img
                src={BRAND_LOGO_URL}
                srcSet={BRAND_LOGO_SRCSET}
                sizes="(max-width: 640px) 80px, 96px"
                alt="SERVIPARTZ"
                className="h-full w-full object-cover scale-[1.06] [image-rendering:auto] [image-rendering:-webkit-optimize-contrast]"
                width={112}
                height={112}
                decoding="async"
                loading="eager"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SERVIPARTZ POS</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <Label htmlFor="login-username" className="text-slate-700 dark:text-slate-300">
                Usuario
              </Label>
              <div className="flex min-w-0 rounded-md border border-slate-300 bg-slate-50/80 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="relative min-w-0 flex-1">
                  <User className="pointer-events-none absolute left-3 top-1/2 z-[1] h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Select
                    value={selectedEmail}
                    onValueChange={(v) => {
                      setSelectedEmail(v);
                      setPin('');
                    }}
                    disabled={directoryLoading || directory.length === 0}
                  >
                    <SelectTrigger
                      id="login-username"
                      aria-label="Seleccionar usuario"
                      className="h-10 w-full min-w-0 border-0 bg-transparent pl-10 pr-8 text-left text-base text-slate-900 shadow-none focus:ring-0 focus-visible:ring-0 data-[size=default]:h-10 dark:text-slate-100 md:h-10 md:text-sm"
                    >
                      <SelectValue
                        placeholder={directoryLoading ? 'Cargando usuarios…' : 'Seleccione usuario'}
                      />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      hideScrollButtons
                      className="z-[100] border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {directory.map((u) => (
                        <SelectItem
                          key={u.id}
                          value={u.email}
                          className="text-slate-900 focus:bg-slate-100 dark:text-slate-100 dark:focus:bg-slate-800"
                        >
                          {labelByEmail.get(u.email) ?? u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-pin" className="text-slate-700 dark:text-slate-300">
                Contraseña
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <Input
                  id="login-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  enterKeyHint="done"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_PIN_LEN))
                  }
                  placeholder="Teclado o botones (solo números)"
                  disabled={formBusy}
                  className="h-10 border-slate-300 bg-slate-50/80 pl-10 font-mono tracking-widest text-slate-900 placeholder:text-slate-500 focus:border-cyan-500/50 focus-visible:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:placeholder:text-slate-600"
                />
              </div>
              <PinKeypadGrid value={pin} onChange={setPin} disabled={formBusy} />
            </div>

            <Button
              type="submit"
              disabled={formBusy || directory.length === 0}
              className={cn(
                'w-full h-12 text-base font-semibold rounded-xl',
                'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500',
                'text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40',
                'transition-all duration-200',
                formBusy && 'opacity-70 cursor-not-allowed'
              )}
            >
              {loading ? (
                <LoadingIndicator inline size="sm" message="Cargando" tone="onBrand" />
              ) : (
                'Iniciar Sesión'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
