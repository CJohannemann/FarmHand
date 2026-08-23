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
