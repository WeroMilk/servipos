import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, LoginForm, LoadingIndicator } from '@/components/ui-custom';
import { Dashboard, POS, Inventario, Cotizaciones, Facturas, Clientes, Configuracion } from '@/pages';
import { useAuthStore, useSyncStore, subscribeFirebaseAuth } from '@/stores';
import { initializeDemoData, syncServipartzSeedUsers } from '@/db/database';
import './App.css';

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
    return subscribeFirebaseAuth();
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
          <Route index element={<Dashboard />} />
          <Route path="pos" element={<POS />} />
          <Route path="inventario" element={<Inventario />} />
          <Route path="cotizaciones" element={<Cotizaciones />} />
          <Route path="facturas" element={<Facturas />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="configuracion" element={<Configuracion />} />
        </Route>

        {/* Redirección por defecto */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
