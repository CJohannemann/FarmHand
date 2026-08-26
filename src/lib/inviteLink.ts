/**
 * `?invite=CODE` in the URL — how a farm owner's shared invite link hands a
 * code to a brand new sign-up. Read once at module load, before the app has
 * any chance to navigate away from it, and stripped from the address bar so
 * a reload doesn't try to redeem the same code a second time. Same pattern
 * as lib/authLink.ts for the same reason: capture it before anything else
 * clears it, don't leave it sitting in the URL.
 */
function read(): string | null {
  if (typeof window === 'undefined') return null

  const query = new URLSearchParams(window.location.search)
  const code = query.get('invite')
  if (!code) return null

  query.delete('invite')
  const rest = query.toString()
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash,
  )

  return code
}

export const inviteLinkCode = read()
