import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxying keeps the API same-origin in dev, so the httpOnly
    // SameSite=Strict session cookie works without any CORS relaxation.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // three.js is only needed by the landing hero — keep it out of the
        // bundle the create/reveal pages have to download.
        manualChunks(id: string) {
          if (/node_modules[/\\](three|@react-three)/.test(id)) return 'three'
        },
      },
    },
  },
})
