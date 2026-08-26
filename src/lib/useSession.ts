import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import { authLinkError, type AuthLinkError } from './authLink'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(supabaseConfigured)
  // Set when the user arrived via a password-reset email link — Supabase
  // signs them in automatically for this, but they should choose a new
  // password before landing in the app rather than just being let in.
  const [recovery, setRecovery] = useState(false)
  // Set when they arrived via a link that *failed*. Supabase emits no event
  // for that case, so it comes from the URL instead — see lib/authLink.
  const [linkError, setLinkError] = useState<AuthLinkError | null>(authLinkError)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return {
    session,
    checking,
    recovery,
    clearRecovery: () => setRecovery(false),
    linkError,
    clearLinkError: () => setLinkError(null),
  }
}
