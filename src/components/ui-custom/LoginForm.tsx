import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Moon, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore, useAppStore, getResolvedIsDark } from '@/stores';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { getServipartzEmailDomain } from '@/lib/servipartzAuth';
import { LoadingIndicator } from './LoadingIndicator';

export function LoginForm() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { addToast } = useAppStore();
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const resolvedDark = useAppStore((s) => getResolvedIsDark(s));
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      addToast({
        type: 'error',
        message: 'Por favor ingrese usuario y contraseña',
      });
      return;
    }

    setLoading(true);
    
    try {
      const success = await login(username, password);
      
      if (success) {
        addToast({
          type: 'success',
          message: 'Bienvenido al sistema',
        });
        navigate('/');
      } else {
        addToast({
          type: 'error',
          message: 'Usuario o contraseña incorrectos',
        });
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Error al iniciar sesión',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-0 flex min-h-dvh w-full flex-col items-center overflow-y-auto overflow-x-hidden',
        /* Móvil: entre top y centro (~20dvh bajo safe-area) para teclado sin pegar al borde */
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

      {/* Capa base: gradiente según tema */}
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
            /* Móvil: sin tope de altura ni recorte; la página hace scroll con el teclado */
            'max-sm:max-h-none max-sm:overflow-visible'
          )}
        >
          {/* Logo */}
          <div className="mb-5 flex flex-col items-center sm:mb-6">
            <div className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-cyan-500/15 ring-1 ring-slate-300/80 dark:shadow-cyan-500/20 dark:ring-slate-700/50 sm:mb-4 sm:h-24 sm:w-24">
              <img
                src={BRAND_LOGO_URL}
                alt="SERVIPARTZ"
                className="h-full w-full object-cover"
                width={112}
                height={112}
                decoding="async"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SERVIPARTZ POS</h1>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-700 dark:text-slate-300">Usuario</Label>
              <div className="flex min-w-0 rounded-md border border-slate-300 bg-slate-50/80 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="relative min-w-0 flex-1">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ingrese su usuario"
                    autoComplete="username"
                    className="border-0 bg-transparent pl-10 text-slate-900 shadow-none placeholder:text-slate-500 focus-visible:ring-0 dark:text-slate-100 dark:placeholder:text-slate-600"
                  />
                </div>
                <span
                  className="hidden shrink-0 items-center border-l border-slate-300 px-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400 sm:flex"
                  title="Se agrega automáticamente al iniciar sesión"
                >
                  @{getServipartzEmailDomain()}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingrese su contraseña"
                  autoComplete="current-password"
                  className="border-slate-300 bg-slate-50/80 pl-10 pr-10 text-slate-900 placeholder:text-slate-500 focus:border-cyan-500/50 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-800 dark:hover:text-slate-300"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full h-12 text-base font-semibold rounded-xl',
                'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500',
                'text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40',
                'transition-all duration-200',
                loading && 'opacity-70 cursor-not-allowed'
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
