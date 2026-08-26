import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { authErrorMessage } from '../lib/authLink'

/**
 * Shown after a password-reset email link lands back on the app. Supabase
 * has already signed the browser in at this point (that's how the link
 * proves ownership of the address) — this just makes them choose a new
 * password before treating that as a real, ongoing session.
 */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (password !== confirm) { setError('Those two passwords don’t match.'); return }

    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) { setError(authErrorMessage(error)); return }
    onDone()
  }

  return (
    <main className="screen auth">
      <h1>FarmHand</h1>
      <p className="tagline">Choose a new password.</p>

      <form onSubmit={submit}>
        <label className="field">
          <span>New password</span>
          <input type="password" autoFocus required minLength={8} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="hint">At least 8 characters.</small>
        </label>

        <label className="field">
          <span>Confirm password</span>
          <input type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Set new password'}
        </button>
      </form>
    </main>
  )
}
