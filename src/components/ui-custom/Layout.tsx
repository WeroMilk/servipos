import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { Header } from './Header';
import { ToastContainer } from './ToastContainer';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { cn } from '@/lib/utils';

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <Sidebar />

      {/* Un solo flex-1: evita que Safari iOS reparta mal el alto entre varios hijos (nav fija + contenido). */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            'flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden',
            'max-md:ml-0 md:ml-72 md:w-[calc(100%-18rem)]'
          )}
        >
          {/*
          Área de trabajo a pantalla completa junto al sidebar (sin “marco” flotante).
          Solo safe-area en dispositivos con notch/recortes.
        */}
          <div
            className={cn(
              'box-border flex min-h-0 flex-1 basis-0 flex-col overflow-hidden',
              'pt-[env(safe-area-inset-top,0px)]',
              'pr-[env(safe-area-inset-right,0px)]',
              'pb-[env(safe-area-inset-bottom,0px)] max-md:pb-0'
            )}
          >
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950',
                'md:border-l md:border-slate-200/80 dark:md:border-slate-800/60'
              )}
            >
              <Header />
              <main
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden px-2 pt-0.5 sm:px-3 md:px-4 lg:px-5',
                  'pb-[calc(3.75rem+0.5rem+env(safe-area-inset-bottom,0px))] md:pb-3.5'
                )}
              >
                <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
                  <RouteErrorBoundary routePath={location.pathname}>
                    <Outlet />
                  </RouteErrorBoundary>
                </div>
              </main>
            </div>
          </div>
        </div>

        <MobileBottomNav />
        <ToastContainer />
      </div>
    </div>
  );
}
