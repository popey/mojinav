import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read VITE_PUBLIC_HOST from the environment (or .env files). When set
  // (e.g. "mojinav.popey.com"), Vite will accept that Host header and route
  // HMR back through the public TLS endpoint — needed when the dev server
  // sits behind a reverse proxy like Cloudflare. Unset = local dev only.
  const env = loadEnv(mode, process.cwd(), '')
  const publicHost = env.VITE_PUBLIC_HOST?.trim()
  // Local dev: point at `wrangler dev` (worker/) running on :8787.
  // In production, Cloudflare intercepts /api/* before it reaches Vite,
  // so this proxy is local-only.
  const apiUrl = env.VITE_API_URL?.trim() || 'http://localhost:8787'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      ...(publicHost && {
        allowedHosts: [publicHost],
        hmr: {
          host: publicHost,
          protocol: 'wss',
          clientPort: 443,
        },
      }),
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
