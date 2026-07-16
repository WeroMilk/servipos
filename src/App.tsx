import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, LoginForm, LoadingIndicator } from '@/components/ui-custom';
import { useAuthStore, useSyncStore, subscribeSupabaseAuth } from '@/stores';
import { initializeDemoData, syncServipartzSeedUsers } from '@/db/database';
import { setAppEventActorResolver } from '@/lib/appEventContext';
import { getEffectiveSucursalId } from '@/lib/effectiveSucursal';

const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const POS = lazy(() => import('@/pages/POS').then((m) => ({ default: m.POS })));
const Inventario = lazy(() => import('@/pages/Inventario').then((m) => ({ default: m.Inventario })));
const RecepcionPedidos = lazy(() =>
  import('@/pages/RecepcionPedidos').then((m) => ({ default: m.RecepcionPedidos }))
);
const SalidasMercancia = lazy(() =>
  import('@/pages/SalidasMercancia').then((m) => ({ default: m.SalidasMercancia }))
);
const EtiquetasProductos = lazy(() =>
  import('@/pages/EtiquetasProductos').then((m) => ({ default: m.EtiquetasProductos }))
);
const MisionInventario = lazy(() =>
  import('@/pages/MisionInventario').then((m) => ({ default: m.MisionInventario }))
);
const Cotizaciones = lazy(() => import('@/pages/Cotizaciones').then((m) => ({ default: m.Cotizaciones })));
const Facturas = lazy(() => import('@/pages/Facturas').then((m) => ({ default: m.Facturas })));
const Clientes = lazy(() => import('@/pages/Clientes').then((m) => ({ default: m.Clientes })));
const ClientePerfil = lazy(() => import('@/pages/ClientePerfil').then((m) => ({ default: m.ClientePerfil })));
const CuentasPorCobrar = lazy(() =>
  import('@/pages/CuentasPorCobrar').then((m) => ({ default: m.CuentasPorCobrar }))
);
const Nominas = lazy(() => import('@/pages/Nominas').then((m) => ({ default: m.Nominas })));
const Configuracion = lazy(() => import('@/pages/Configuracion').then((m) => ({ default: m.Configuracion })));
const Checador = lazy(() => import('@/pages/Checador').then((m) => ({ default: m.Checador })));

function PageFallback({ message }: { message: string }) {
  return <LoadingIndicator inline message={message} tone="onBrand" />;
}

setAppEventActorResolver(() => {
  const u = useAuthStore.getState().user;
  return {
    userId: u?.id ?? null,
    name: u?.name ?? 'Invitado',
    email: u?.email ?? '',
    role: u?.role ?? 'guest',
    sucursalId: getEffectiveSucursalId(),
  };
});

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
    </BrowserRouter>
  );
}

export default App;
