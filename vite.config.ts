import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves from /<repo-name>/; CI sets VITE_BASE_PATH accordingly.
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // custom sw for web push; precaching behaves like generateSW did
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'Routine Tracker',
        short_name: 'Routines',
        description: 'AuDHD-friendly routine tracker with conversational check-off',
        theme_color: '#1a1714',
        background_color: '#1a1714',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        // Android: share text into the installed PWA (iOS has no share target)
        share_target: {
          action: base,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
})
