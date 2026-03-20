import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore, useAppStore } from '@/stores';
import { cn } from '@/lib/utils';
import { BRAND_LOGO_URL } from '@/lib/branding';
import { getServipartzEmailDomain } from '@/lib/servipartzAuth';
import { LoadingIndicator } from './LoadingIndicator';

export function LoginForm() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { addToast } = useAppStore();
  
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
    <div className="fixed inset-0 z-0 flex min-h-dvh w-full flex-col items-center justify-center overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8">
      {/* Capa base: azul en todo el viewport (sin bandas negras en los bordes) */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-950 via-blue-950 to-cyan-950"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-1/4 top-0 h-[min(100dvh,56rem)] w-[min(140vw,56rem)] rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute -right-1/4 bottom-0 h-[min(100dvh,52rem)] w-[min(130vw,52rem)] rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[min(90dvh,40rem)] w-[min(90vw,40rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full min-w-0 max-w-md">
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 opacity-25 blur" />

        <div className="relative max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-xl sm:max-h-none sm:p-7">
          {/* Logo */}
          <div className="mb-5 flex flex-col items-center sm:mb-6">
            <div className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-cyan-500/20 ring-1 ring-slate-700/50 sm:mb-4 sm:h-24 sm:w-24">
              <img
                src={BRAND_LOGO_URL}
                alt="SERVIPARTZ"
                className="h-full w-full object-cover"
                width={112}
                height={112}
                decoding="async"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-100">SERVIPARTZ POS</h1>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-300">Usuario</Label>
              <div className="flex min-w-0 rounded-md border border-slate-700 bg-slate-900/50 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20">
                <div className="relative min-w-0 flex-1">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    className="border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0"
                  />
                </div>
                <span
                  className="hidden shrink-0 items-center border-l border-slate-700 px-3 text-sm text-slate-400 sm:flex"
                  title="Se agrega automáticamente al iniciar sesión"
                >
                  @{getServipartzEmailDomain()}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingrese su contraseña"
                  autoComplete="current-password"
                  className="pl-10 pr-10 bg-slate-900/50 border-slate-700 text-slate-100 
                             placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 
                             hover:text-slate-300 transition-colors"
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
