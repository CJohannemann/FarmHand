import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Whether .env holds real credentials. Until it does the app runs entirely
 * on the local database — no sign-in, no account, everything still works.
 * That keeps development possible without a Supabase project.
 */
export const supabaseConfigured =
  url.startsWith('https://') &&
  !url.includes('YOUR-PROJECT-REF') &&
  key.length > 20 &&
  !key.startsWith('your-')

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        // Session is kept in localStorage, so the app opens signed in even
        // with no signal — which is the point of an app used in a barn.
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

/**
 * postgrest-js swallows the real cause of a client-side network failure (a
 * raw fetch() rejection — DNS, TLS, an aborted request, headers over a
 * server limit) into a bare `TypeError: Load failed`/`Failed to fetch` on
 * `.message`, but stashes the actual detail — often the fetch error's own
 * stack, or a `.cause` chain with a specific reason — on `.details`/`.hint`
 * instead. Every call site that threw `.message` alone turned a failure
 * only reproducible on one specific device into a dead end with no way to
 * tell why; surfacing all three is the difference.
 */
export function describeError(error: {
  message: string
  hint?: string | null
  details?: string | null
}): string {
  const parts = [error.message]
  if (error.hint) parts.push(`hint: ${error.hint}`)
  if (error.details) parts.push(`details: ${error.details}`)
  return parts.join(' — ')
}
