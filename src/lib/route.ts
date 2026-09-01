import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * The whole router. Five paths, no nested routes, no params — a dependency
 * like react-router would be more code to configure than the thing it
 * replaces, and this app's screens are already chosen by a chain of
 * conditions in App.tsx rather than by URL matching.
 *
 * nginx already serves index.html for any path it can't find on disk
 * (`try_files $uri /index.html` in deploy/nginx-farmhand.conf), so
 * /login is a real, refreshable, shareable URL and not just a
 * pushState illusion that 404s when someone reloads.
 */
export type Route = '/' | '/account' | '/login' | '/signup'

/**
 * What useRoute() reports: a known route, or that nothing matched. Kept
 * distinct from Route so navigate() can't be handed 'not-found' — there is
 * no such URL to navigate to, it's a description of the one already in the
 * address bar.
 */
export type Location = Route | 'not-found'

const ROUTES: Route[] = ['/', '/account', '/login', '/signup']

/**
 * A native build has no address bar and always boots index.html at '/',
 * which on the web now means the marketing page — nobody who installed the
 * app from a store needs to be sold on it. Everything else about routing
 * works the same there: pushState still moves between screens, it just
 * starts from the app instead of the pitch.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

function read(): Location {
  if (isNative()) return '/account'
  // Trailing slashes only, so /login/ and /login are the same screen.
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return (ROUTES as string[]).includes(path) ? (path as Route) : 'not-found'
}

/**
 * pushState deliberately does NOT fire popstate — that event is for the
 * back button, and a browser firing it on programmatic navigation would
 * make every history entry a loop. So navigate() re-dispatches it by hand
 * to tell useRoute() something changed; the alternative is a module-level
 * subscriber list, which is the same thing with more parts.
 */
export function navigate(to: Route, opts: { replace?: boolean } = {}): void {
  if (read() === to) return
  if (opts.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Location {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onPop = () => setRoute(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return route
}
