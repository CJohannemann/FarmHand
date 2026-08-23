import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // PGlite ships a WASM build that Vite must not try to pre-bundle.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
})
