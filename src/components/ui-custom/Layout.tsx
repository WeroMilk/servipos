import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from './ToastContainer';
import { useAppStore } from '@/stores';
import { cn } from '@/lib/utils';

export function Layout() {
  const { sidebarCollapsed } = useAppStore();

  return (
    <div className="h-dvh min-h-dvh overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <Sidebar />

      <div
        className={cn(
          'flex h-dvh min-h-0 flex-col overflow-hidden transition-[margin] duration-300 ease-in-out',
          'max-md:ml-20',
          sidebarCollapsed ? 'md:ml-20' : 'md:ml-72'
        )}
      >
        {/*
          Área de trabajo a pantalla completa junto al sidebar (sin “marco” flotante).
          Solo safe-area en dispositivos con notch/recortes.
        */}
        <div
          className={cn(
            'box-border flex min-h-0 flex-1 flex-col overflow-hidden',
            'pt-[env(safe-area-inset-top,0px)]',
            'pr-[env(safe-area-inset-right,0px)]',
            'pb-[env(safe-area-inset-bottom,0px)]'
          )}
        >
          <div
            className={cn(
              'animate-fadeIn flex min-h-0 flex-1 flex-col overflow-hidden',
              'border-l border-slate-800/60 bg-slate-950'
            )}
          >
            <Header />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-0.5 sm:px-4 sm:pb-3 md:px-5 md:pb-3.5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}
