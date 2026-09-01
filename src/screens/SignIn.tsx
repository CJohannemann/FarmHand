import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { authErrorMessage, type AuthLinkError } from '../lib/authLink'
import { inviteLinkCode } from '../lib/inviteLink'
import { consumeRevokedFlag } from '../lib/revocation'

type Mode = 'in' | 'up' | 'forgot'

export function SignIn({ linkError, onDismissLinkError, onInviteCode, initialMode, onModeChange }: {
  linkError?: AuthLinkError | null
  onDismissLinkError?: () => void
  /** Which form to open on, e.g. 'up' when arriving via a "create account" CTA. Defaults to 'in'. */
  initialMode?: Mode
  /** Fired when the reader switches forms from inside the screen, so the URL can follow. */
  onModeChange?: (mode: Mode) => void
  /**
   * Fired with whatever's in the invite-code field right as a sign-in or
   * sign-up succeeds — App.tsx redeems it centrally (see its own comment
   * on why), not here. Firing on both sign-in and sign-up, not just
   * sign-up, is what lets someone retry: a first attempt with a since-
   * expired or already-used code still creates their account, and the
   * natural next step — signing back in — gets a fresh shot at redeeming
   * a corrected code without making them start over.
   */
  onInviteCode?: (code: string) => void
} = {}) {
  // A dead reset link lands here. Open on the form that fixes it rather than
  // making them find "Forgot your password?" again after being told to.
  const [mode, setMode] = useState<Mode>(linkError ? 'forgot' : initialMode ?? 'in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Arriving via a farm owner's shared link pre-fills this and jumps
  // straight to sign-up — that's the whole point of the link. Editable
  // regardless, for a code read aloud/texted as plain text instead.
  const [inviteCode, setInviteCode] = useState(inviteLinkCode ?? '')
  // Read (and cleared) once, on first mount — true only when this screen is
  // showing because an owner just removed this account from its farm.
  const [revoked] = useState(() => consumeRevokedFlag())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dismissLink = () => onDismissLinkError?.()
  const switchTo = (m: Mode) => {
    setMode(m); setError(null); setNotice(null); dismissLink(); onModeChange?.(m)
  }
  const showInviteField = mode === 'up' || inviteCode.trim().length > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null); setNotice(null); dismissLink()

    if (mode === 'forgot') {
      // The link this sends back lands on this same page — Supabase's
      // client picks the recovery tokens out of the URL itself and fires
      // a PASSWORD_RECOVERY auth event, which App.tsx watches for. If it
      // instead comes back with an error, lib/authLink catches that.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      setBusy(false)
      if (error) { setError(authErrorMessage(error)); return }
      setNotice('Check your email for a link to reset your password. Open it on ' +
        'this device, and use it straight away — it only works once.')
      return
    }

    const fn = mode === 'in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({
          email,
          password,
          options: {
            // Where the confirmation link lands. Without this it goes to
            // SITE_URL, which is '/' — the marketing page — so someone who
            // had just proved their email arrived signed in but looking at
            // the pitch, with no sign that anything had happened. /account drops
            // them straight into setting the farm up, which is the next
            // thing they were going to do anyway.
            //
            // Allowed already by GOTRUE_URI_ALLOW_LIST's trailing /**; a
            // redirect outside that list is silently ignored and falls back
            // to SITE_URL, which is exactly the old behaviour and would look
            // like this change had simply not worked.
            emailRedirectTo: `${window.location.origin}/account`,
          },
        })

    const { data, error } = await fn
    setBusy(false)

    if (error) { setError(authErrorMessage(error)); return }
    // Signing up with email confirmation on returns a user but no session.
    if (mode === 'up' && !data.session) {
      setNotice('Check your email for a confirmation link, then sign in.')
      setMode('in')
      return
    }
    if (inviteCode.trim()) onInviteCode?.(inviteCode.trim())
  }

  return (
    <main className="screen auth">
      <h1>Farmhand Management</h1>
      <p className="tagline">
        {mode === 'in' && 'Sign in to your farm.'}
        {mode === 'up' && 'Create your account.'}
        {mode === 'forgot' && 'Reset your password.'}
      </p>

      {linkError && <p className="error">{linkError.message}</p>}
      {revoked && <p className="error">Your access to that farm was removed.</p>}

      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>

        {mode !== 'forgot' && (
          <label className="field">
            <span>Password</span>
            <input type="password" required minLength={8}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'up' && <small className="hint">At least 8 characters.</small>}
          </label>
        )}

        {showInviteField && (
          <label className="field">
            <span>Invite code</span>
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
              placeholder="From the person who invited you" />
            <small className="hint">Leave blank to start your own farm instead.</small>
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…'
            : mode === 'in' ? 'Sign in'
            : mode === 'up' ? 'Create account'
            : 'Send reset link'}
        </button>
      </form>

      {mode === 'in' && (
        <button className="linkish" onClick={() => switchTo('forgot')}>
          Forgot your password?
        </button>
      )}

      <button className="linkish"
        onClick={() => switchTo(mode === 'up' ? 'in' : mode === 'forgot' ? 'in' : 'up')}>
        {mode === 'in' && 'No account yet? Create one'}
        {mode === 'up' && 'Already have an account? Sign in'}
        {mode === 'forgot' && 'Back to sign in'}
      </button>
    </main>
  )
}
