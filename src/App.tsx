import React, { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout, LoginForm, LoadingIndicator, RouteErrorBoundary } from '@/components/ui-custom';
import { useAuthStore, useSyncStore, subscribeSupabaseAuth } from '@/stores';
import { initializeDemoData, syncServipartzSeedUsers } from '@/db/database';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const Dashboard = lazyWithRetry(() =>
  import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const POS = lazyWithRetry(() => import('@/pages/POS').then((m) => ({ default: m.POS })));
const Inventario = lazyWithRetry(() =>
  import('@/pages/Inventario').then((m) => ({ default: m.Inventario }))
);
const RecepcionPedidos = lazyWithRetry(() =>
  import('@/pages/RecepcionPedidos').then((m) => ({ default: m.RecepcionPedidos }))
);
const SalidasMercancia = lazyWithRetry(() =>
  import('@/pages/SalidasMercancia').then((m) => ({ default: m.SalidasMercancia }))
);
const EtiquetasProductos = lazyWithRetry(() =>
  import('@/pages/EtiquetasProductos').then((m) => ({ default: m.EtiquetasProductos }))
);
const MisionInventario = lazyWithRetry(() =>
  import('@/pages/MisionInventario').then((m) => ({ default: m.MisionInventario }))
);
const Cotizaciones = lazyWithRetry(() =>
  import('@/pages/Cotizaciones').then((m) => ({ default: m.Cotizaciones }))
);
const Facturas = lazyWithRetry(() =>
  import('@/pages/Facturas').then((m) => ({ default: m.Facturas }))
);
const Clientes = lazyWithRetry(() =>
  import('@/pages/Clientes').then((m) => ({ default: m.Clientes }))
);
const ClientePerfil = lazyWithRetry(() =>
  import('@/pages/ClientePerfil').then((m) => ({ default: m.ClientePerfil }))
);
const CuentasPorCobrar = lazyWithRetry(() =>
  import('@/pages/CuentasPorCobrar').then((m) => ({ default: m.CuentasPorCobrar }))
);
const Nominas = lazyWithRetry(() =>
  import('@/pages/Nominas').then((m) => ({ default: m.Nominas }))
);
const Promociones = lazyWithRetry(() =>
  import('@/pages/Promociones').then((m) => ({ default: m.Promociones }))
);
const Configuracion = lazyWithRetry(() =>
  import('@/pages/Configuracion').then((m) => ({ default: m.Configuracion }))
);
const Checador = lazyWithRetry(() =>
  import('@/pages/Checador').then((m) => ({ default: m.Checador }))
);

function PageFallback({ message }: { message: string }) {
  return <LoadingIndicator inline message={message} tone="onBrand" />;
}

// ============================================
// COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ============================================

function AuthSessionLoading() {
  return <LoadingIndicator fullScreen message="Cargando" />;
}

// Ruta protegida que requiere autenticación
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authReady } = useAuthStore();
  if (!authReady) return <AuthSessionLoading />;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

// Ruta pública que redirige si ya está autenticado
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authReady } = useAuthStore();
  if (!authReady) return <AuthSessionLoading />;
  return !isAuthenticated ? <>{children}</> : <Navigate to="/" replace />;
}

function App() {
  const { checkConnection } = useSyncStore();

  useEffect(() => {
    return subscribeSupabaseAuth();
  }, []);

  // Inicializar datos de demo al cargar
  useEffect(() => {
    void (async () => {
      await initializeDemoData();
      await syncServipartzSeedUsers();
    })();
  }, []);

  // Verificar conexión periódicamente
  useEffect(() => {
    const interval = setInterval(() => {
      checkConnection();
    }, 30000); // Cada 30 segundos

    return () => clearInterval(interval);
  }, [checkConnection]);

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Precarga en idle las pantallas para que el menú no dispare imports en frío.
  useEffect(() => {
    if (!isAuthenticated) return;
    const warm = () => {
      void import('@/pages/Dashboard');
      void import('@/pages/POS');
      void import('@/pages/Inventario');
      void import('@/pages/Clientes');
      void import('@/pages/Cotizaciones');
      void import('@/pages/Facturas');
      void import('@/pages/CuentasPorCobrar');
      void import('@/pages/Configuracion');
      void import('@/pages/Checador');
      void import('@/pages/RecepcionPedidos');
      void import('@/pages/SalidasMercancia');
      void import('@/pages/EtiquetasProductos');
      void import('@/pages/MisionInventario');
      void import('@/pages/Nominas');
      void import('@/pages/Promociones');
      void import('@/pages/ClientePerfil');
    };
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric(warm, { timeout: 4000 });
      return () => {
        const cic = (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback;
        cic?.(id);
      };
    }
    const t = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(t);
  }, [isAuthenticated]);

  return (
    <RouteErrorBoundary routePath={location.pathname}>
      <Routes>
              {/* Ruta de Login */}
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <LoginForm />
                  </PublicRoute>
                }
              />
      
              {/* Rutas protegidas con Layout */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={
                    <Suspense fallback={<PageFallback message="Cargando panel" />}>
                      <Dashboard />
                    </Suspense>
                  }
                />
                <Route
                  path="pos"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando punto de venta" />}>
                      <POS />
                    </Suspense>
                  }
                />
                <Route
                  path="inventario"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando inventario" />}>
                      <Inventario />
                    </Suspense>
                  }
                />
                <Route
                  path="inventario/recepcion-pedidos"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando recepción" />}>
                      <RecepcionPedidos />
                    </Suspense>
                  }
                />
                <Route
                  path="inventario/salidas-mercancia"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando salidas" />}>
                      <SalidasMercancia />
                    </Suspense>
                  }
                />
                <Route
                  path="etiquetas-productos"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando etiquetas" />}>
                      <EtiquetasProductos />
                    </Suspense>
                  }
                />
                <Route
                  path="mision-inventario"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando misión inventario" />}>
                      <MisionInventario />
                    </Suspense>
                  }
                />
                <Route
                  path="cotizaciones"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando cotizaciones" />}>
                      <Cotizaciones />
                    </Suspense>
                  }
                />
                <Route
                  path="checador"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando checador" />}>
                      <Checador />
                    </Suspense>
                  }
                />
                <Route
                  path="facturas"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando facturas" />}>
                      <Facturas />
                    </Suspense>
                  }
                />
                <Route
                  path="nominas"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando nóminas" />}>
                      <Nominas />
                    </Suspense>
                  }
                />
                <Route
                  path="promociones"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando promociones" />}>
                      <Promociones />
                    </Suspense>
                  }
                />
                <Route
                  path="clientes"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando clientes" />}>
                      <Clientes />
                    </Suspense>
                  }
                />
                <Route
                  path="clientes/:clientId"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando perfil" />}>
                      <ClientePerfil />
                    </Suspense>
                  }
                />
                <Route
                  path="cuentas-por-cobrar"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando cuentas por cobrar" />}>
                      <CuentasPorCobrar />
                    </Suspense>
                  }
                />
                <Route
                  path="configuracion"
                  element={
                    <Suspense fallback={<PageFallback message="Cargando configuración" />}>
                      <Configuracion />
                    </Suspense>
                  }
                />
              </Route>
      
              {/* Redirección por defecto */}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
    </RouteErrorBoundary>
  );
}

export default App;
