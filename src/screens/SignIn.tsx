import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null); setNotice(null)

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
        {mode === 'in' ? 'Sign in to your farm.' : 'Create your account.'}
      </p>

      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="field">
          <span>Password</span>
          <input type="password" required minLength={8}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'up' && <small className="hint">At least 8 characters.</small>}
        </label>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button className="linkish"
        onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null) }}>
        {mode === 'in'
          ? 'No account yet? Create one'
          : 'Already have an account? Sign in'}
      </button>
    </main>
  )
}
