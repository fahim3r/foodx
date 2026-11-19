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
      // Phase 9: precache the built app shell so the panel OPENS
      // offline (the offline order queue then survives reloads and
      // syncs when connectivity returns). Runtime data (menu,
      // orders) is still fetched live — see OFFLINE_SYNC.md.
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'FoodX',
        short_name: 'FoodX',
        description: 'FoodX — Every order. Under control.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#ffffff',
        theme_color: '#ea580c',
        shortcuts: [
          { name: 'Waiter', url: '/panel/waiter' },
          { name: 'Kitchen', url: '/panel/kds' },
          { name: 'To Serve', url: '/panel/serve' },
          { name: 'Waiting Display', url: '/panel/display' },
        ],
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
