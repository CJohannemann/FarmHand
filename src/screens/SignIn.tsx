import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'in' | 'up' | 'forgot'

export function SignIn() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const switchTo = (m: Mode) => { setMode(m); setError(null); setNotice(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null); setNotice(null)

    if (mode === 'forgot') {
      // The link this sends back lands on this same page — Supabase's
      // client picks the recovery tokens out of the URL itself and fires
      // a PASSWORD_RECOVERY auth event, which App.tsx watches for.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      setBusy(false)
      if (error) { setError(error.message); return }
      setNotice('Check your email for a link to reset your password.')
      return
    }

    const fn = mode === 'in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })

    const { data, error } = await fn
    setBusy(false)

    if (error) { setError(error.message); return }
    // Signing up with email confirmation on returns a user but no session.
    if (mode === 'up' && !data.session) {
      setNotice('Check your email for a confirmation link, then sign in.')
      setMode('in')
    }
  }

  return (
    <main className="screen auth">
      <h1>FarmHand</h1>
      <p className="tagline">
        {mode === 'in' && 'Sign in to your farm.'}
        {mode === 'up' && 'Create your account.'}
        {mode === 'forgot' && 'Reset your password.'}
      </p>

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
