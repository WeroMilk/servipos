import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import {
  clearChunkReloadFlag,
  installChunkLoadRecoveryListeners,
} from '@/lib/lazyWithRetry'

// Si la app arrancó bien, liberar el candado de recarga por chunks viejos.
clearChunkReloadFlag()
installChunkLoadRecoveryListeners()

// Quitar marca de cache-bust de la URL tras una recuperación exitosa.
try {
  const url = new URL(window.location.href)
  if (url.searchParams.has('_cb')) {
    url.searchParams.delete('_cb')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }
} catch {
  /* ignore */
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // Buscar actualizaciones del service worker con frecuencia
    // (evita quedarse con HTML/JS viejos tras un deploy).
    const pollMs = 5 * 60 * 1000
    window.setInterval(() => {
      void registration.update()
    }, pollMs)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void registration.update()
      }
    })
    // Al conectar de nuevo a la red, forzar update.
    window.addEventListener('online', () => {
      void registration.update()
    })
  },
  onOfflineReady() {
    /* ok */
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
