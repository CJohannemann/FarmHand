import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The home page's own words, in the HTML itself.
 *
 * Landing.tsx draws the front page from src/screens/landing.html, but only
 * once the app's JavaScript runs. A corporate web filter's crawler mostly
 * doesn't run it: it read an empty <div id="root"> and a sign-in, had
 * nothing to classify, and filed the site "uncategorized" — isolated or
 * blocked on work networks. This writes the same landing.html into the
 * page at build time, so what is read without JavaScript is the page a
 * visitor sees: farm record keeping, livestock, crops, costs.
 *
 * Nothing changes for a visitor. React replaces #root's contents with the
 * same markup when it mounts. Every other address (/account, /login...)
 * and the Android app remove the copy in the inline script that follows
 * it, which runs before the browser draws anything, so they never flash
 * the front page.
 */
function landingInPage(): Plugin {
  return {
    name: 'landing-in-page',
    transformIndexHtml(html) {
      const landing = readFileSync(new URL('./src/screens/landing.html', import.meta.url), 'utf8')
      return html.replace(
        '<div id="root"></div>',
        `<div id="root"><div id="prerender">${landing}</div></div>
    <script>
      if (location.pathname.replace(/\\/+$/, '') !== '' || window.Capacitor) {
        document.getElementById('prerender').remove()
      }
    </script>`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), landingInPage()],
  // wa-sqlite (like PGlite before it) ships a WASM build that Vite must not
  // try to pre-bundle — esbuild's dependency pre-bundling pass mangles the
  // Emscripten-generated glue code's own WASM-loading logic.
  optimizeDeps: { exclude: ['@electric-sql/pglite', 'wa-sqlite'] },
  // The db worker (src/db/worker.ts) code-splits internally; the default
  // "iife" worker format can't support that.
  worker: { format: 'es' },
})
