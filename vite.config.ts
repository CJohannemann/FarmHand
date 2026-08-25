import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // PGlite ships a WASM build that Vite must not try to pre-bundle.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  // The db worker (src/db/worker.ts) code-splits internally; the default
  // "iife" worker format can't support that.
  worker: { format: 'es' },
})
