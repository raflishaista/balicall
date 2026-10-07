import path from 'node:path'
import os from 'node:os'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), 'vite-balicall-client'),
  server: {
    host: '0.0.0.0',
    port: 5187,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
})

