import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { clearChunkReloadFlag } from '@/lib/lazyWithRetry'

// Si la app arrancó bien, liberar el candado de recarga por chunks viejos.
clearChunkReloadFlag()

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // Buscar actualizaciones del service worker mientras la app sigue abierta
    // (evita quedarse con HTML/JS viejos tras un deploy).
    const hourMs = 60 * 60 * 1000
    window.setInterval(() => {
      void registration.update()
    }, hourMs)
    // También al volver a la pestaña
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void registration.update()
      }
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
