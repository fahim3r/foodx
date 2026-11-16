import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Manifest only for Phase 1. Full offline precaching / runtime
      // caching is a later phase — the service worker currently
      // precaches nothing (empty globPatterns).
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: [],
      },
      manifest: {
        name: 'FoodX',
        short_name: 'FoodX',
        description: 'FoodX — restaurant management platform',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#ffffff',
        theme_color: '#ea580c',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
