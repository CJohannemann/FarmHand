import type { Route } from '../lib/route'

/**
 * Shown for a URL the router doesn't recognize — a typo, an old link, a
 * guessed path. The address bar is deliberately left as typed rather than
 * rewritten to '/': quietly swapping someone's URL for a different page
 * hides the mistake instead of naming it, and makes a mistyped bookmark
 * look like it worked.
 *
 * Borrows the boot screen's layout and the existing button styles rather
 * than bringing its own — a 404 is the last place worth introducing a new
 * visual idiom, and this way it follows the app's theme for free.
 */
export function NotFound({ signedIn, onGo }: {
  signedIn: boolean
  onGo: (to: Route) => void
}) {
  return (
    <main className="screen boot">
      <h1>Farm Hand Manager</h1>
      <p className="muted">There's nothing at this address.</p>
      <p className="muted">
        <code>{window.location.pathname}</code>
      </p>

      {signedIn ? (
        <>
          <button className="primary" onClick={() => onGo('/account')}>
            Open your farm
          </button>
          <button className="linkish" onClick={() => onGo('/')}>
            Back to the front page
          </button>
        </>
      ) : (
        <>
          <button className="primary" onClick={() => onGo('/')}>
            Back to the front page
          </button>
          <button className="linkish" onClick={() => onGo('/login')}>
            Sign in
          </button>
        </>
      )}
    </main>
  )
}
