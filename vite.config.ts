import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // wa-sqlite (like PGlite before it) ships a WASM build that Vite must not
  // try to pre-bundle — esbuild's dependency pre-bundling pass mangles the
  // Emscripten-generated glue code's own WASM-loading logic.
  optimizeDeps: { exclude: ['@electric-sql/pglite', 'wa-sqlite'] },
  // The db worker (src/db/worker.ts) code-splits internally; the default
  // "iife" worker format can't support that.
  worker: { format: 'es' },
})
