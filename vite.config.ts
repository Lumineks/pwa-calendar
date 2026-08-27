import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const workerUrl = env['VITE_WORKER_URL'] ?? ''
  let workerOrigin = ''
  try {
    if (workerUrl) workerOrigin = new URL(workerUrl).origin
  } catch {
    // ignore invalid URL — runtimeCaching will be empty
  }

  return {
    base: '/pwa-calendar/',
    plugins: [
      tailwindcss(),
      svelte(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: 'План недели',
          short_name: 'План недели',
          description: 'Личный недельный ежедневник',
          lang: 'ru',
          display: 'standalone',
          start_url: '/pwa-calendar/',
          scope: '/pwa-calendar/',
          theme_color: '#fbf6e9',
          background_color: '#fbf6e9',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          globIgnores: ['**/apple-splash*'],
          runtimeCaching: workerOrigin
            ? [
                {
                  urlPattern: new RegExp('^' + escapeRegExp(workerOrigin)),
                  handler: 'NetworkOnly' as const,
                  options: { cacheName: 'journal-api' },
                },
              ]
            : [],
        },
        devOptions: { enabled: false },
      }),
    ],
  }
})
