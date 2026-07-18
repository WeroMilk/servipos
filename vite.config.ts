import path from "path"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vitest/config"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["servipartz-logo-v2.svg"],
      manifest: {
        name: "SERVIPARTZ | POS",
        short_name: "SERVIPARTZ",
        description: "Punto de venta SERVIPARTZ",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          {
            src: "servipartz-logo-v2.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "servipartz-logo-v2.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2,webp}"],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Bundle principal > 2 MiB (límite por defecto de Workbox)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "index.html",
        // JS/CSS: preferir red para no servir chunks viejos tras un deploy.
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.destination === "script" || request.destination === "style",
            handler: "NetworkFirst",
            options: {
              cacheName: "servipos-assets-runtime",
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "servipos-html-runtime",
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
