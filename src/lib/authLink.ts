/**
 * What an email auth link left behind in the URL when it failed.
 *
 * Supabase reports a bad recovery/confirmation link by bouncing the browser
 * back to the app with the failure in the URL fragment:
 *
 *   https://app.example.com/#error=access_denied&error_code=otp_expired&...
 *
 * supabase-js notices, throws internally, and drops it — the client's
 * constructor kicks off initialize() as fire-and-forget with a `.catch()`
 * that swallows the error, and no auth event is emitted. So there is no
 * callback to listen on: the only record of what went wrong is the URL
 * itself, which is why this reads it directly.
 *
 * Captured at module load, before anything clears it, and stripped from the
 * address bar so a reload doesn't resurrect a stale complaint.
 */

export type AuthLinkError = { code: string | null; message: string }

function friendly(code: string | null, description: string | null): string {
  switch (code) {
    case 'otp_expired':
      return 'That link has expired or was already used. Reset links are good ' +
        'for one click — send yourself a fresh one below.'
    case 'access_denied':
      return 'That link is no longer valid. Send yourself a fresh one below.'
    default:
      // error_description arrives URL-encoded with + for spaces, and is
      // written for a human already — prefer it over inventing wording.
      return description ?? 'That link could not be used. Send yourself a fresh one below.'
  }
}

function read(): AuthLinkError | null {
  if (typeof window === 'undefined') return null

  // The fragment is where the implicit flow puts it; the query string is
  // where a PKCE-style bounce would. Check both rather than guess.
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const pick = (k: string) => hash.get(k) ?? query.get(k)

  const error = pick('error')
  const code = pick('error_code')
  const description = pick('error_description')
  if (!error && !code && !description) return null

  // Clear only the auth keys — anything else in the URL belongs to the app.
  for (const params of [hash, query]) {
    for (const k of ['error', 'error_code', 'error_description', 'sb']) params.delete(k)
  }
  const rest = query.toString()
  const restHash = hash.toString()
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + (rest ? `?${rest}` : '') + (restHash ? `#${restHash}` : ''),
  )

  return { code: code ?? error, message: friendly(code, description) }
}

export const authLinkError = read()

/**
 * Human wording for an auth failure.
 *
 * supabase-js reports a request that never completed with whatever the
 * platform's fetch said — "Load failed" on Safari/iOS, "Failed to fetch" on
 * Chrome, "NetworkError..." on Firefox. None of those tell a user anything,
 * and all three mean the same thing: the backend didn't answer. That is a
 * different problem from a wrong password, and worth saying so, because the
 * two have completely different fixes.
 */
export function authErrorMessage(error: { message: string }): string {
  const m = error.message
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(m)) {
    return 'Could not reach the server — it accepted the request but never ' +
      'answered. Check your connection; if the rest of the app is working, ' +
      'the problem is on the server side, not with your account.'
  }
  return m
}
