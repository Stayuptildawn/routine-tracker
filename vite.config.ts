import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves from /<repo-name>/; CI sets VITE_BASE_PATH accordingly.
const base = process.env.VITE_BASE_PATH ?? '/'

/** The client bundle is public. Refuse to build with a key that bypasses
 *  RLS (a new-style sb_secret_ key or a legacy JWT whose role is service_role). */
function assertPublicKey(key: string | undefined) {
  if (!key) return
  const k = key.trim().replace(/^["']|["']$/g, '')
  let role: string | undefined
  try {
    role = JSON.parse(Buffer.from(k.split('.')[1] ?? '', 'base64url').toString()).role
  } catch {
    /* not a JWT - new-style keys are checked by prefix */
  }
  if (k.startsWith('sb_secret_') || role === 'service_role') {
    throw new Error('VITE_SUPABASE_API_KEY is a secret/service_role key - use the publishable (anon) key')
  }
}

export default defineConfig(({ mode }) => {
  assertPublicKey(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_API_KEY)
  return {
  base,
  build: {
    rollupOptions: {
      output: {
        // vendor code changes far less often than app code - splitting it out
        // keeps the app chunk small and lets updates re-download less
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // custom sw for web push; precaching behaves like generateSW did
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // the exercise database chunk is on-demand (plan editing only) -
        // keeping it out of the precache keeps installs light
        globIgnores: ['**/exerciseDb-*.js'],
      },
      manifest: {
        name: 'Routine Tracker',
        short_name: 'Routines',
        description: 'A routine tracker that works with your brain — conversational check-off, ADHD-friendly by design',
        theme_color: '#171411',
        background_color: '#171411',
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
}
})
