import { useEffect, useState } from 'react'
import { useAsync } from './lib/useAsync'
import { useSession } from './lib/useSession'
import { useSync } from './lib/useSync'
import { supabase, supabaseConfigured } from './lib/supabase'
import { linkFarm, type FarmLink } from './lib/farm'
import { redeemInvite } from './lib/members'
import { inviteLinkCode } from './lib/inviteLink'
import { db, getSyncState, setSyncState } from './db/client'
import { consumeWipeIfPending, ensureCutover, type CutoverResult } from './db/cutover'
import { resetFarmForTesting } from './db/queries'
import { Today } from './screens/Today'
import { Animals } from './screens/Animals'
import { Records } from './screens/Records'
import { Stores } from './screens/Stores'
import { Analytics } from './screens/Analytics'
import { SignIn } from './screens/SignIn'
import { ResetPassword } from './screens/ResetPassword'
import { SyncBar } from './screens/SyncBar'
import { Setup, FarmName } from './screens/Setup'
import { Settings } from './screens/Settings'

type Tab = 'today' | 'animals' | 'stores' | 'analytics' | 'records'

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today',     label: 'Today',     glyph: '☀️' },
  { id: 'animals',   label: 'Stock',     glyph: '🐄' },
  { id: 'stores',    label: 'Stores',    glyph: '📦' },
  { id: 'analytics', label: 'Analytics', glyph: '📊' },
  { id: 'records',   label: 'Records',   glyph: '📋' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const { session, checking, recovery, clearRecovery, linkError: badLink, clearLinkError } = useSession()
  const [link, setLink] = useState<FarmLink | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const ready = useAsync(async () => { await consumeWipeIfPending(); await db(); return true }, [])

  // A device still on the old (PGlite) local engine needs its outbox
  // drained before that database is thrown away — see db/cutover.ts. Needs
  // a session to push with, so this waits for sign-in; a local-only install
  // (no Supabase configured at all) has nothing to push to or lose, so
  // there is nothing to gate on.
  const [cutover, setCutover] = useState<CutoverResult | null>(null)
  const [cutoverTick, setCutoverTick] = useState(0)
  useEffect(() => {
    if (!ready.data) return
    if (!supabaseConfigured) { setCutover({ ok: true }); return }
    if (!session) return
    let live = true
    ensureCutover().then(
      (r) => { if (live) setCutover(r) },
      (e: Error) => { if (live) setCutover({ ok: false, reason: 'error', message: e.message }) },
    )
    return () => { live = false }
  }, [ready.data, session, cutoverTick])

  useEffect(() => {
    if (cutover?.ok) return
    const retry = () => setCutoverTick((n) => n + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [cutover])

  const cutoverDone = cutover?.ok === true

  // An invite code — from a shared link, or typed into SignIn — must be
  // redeemed BEFORE linkFarm() runs below. linkFarm() adopts whatever farm
  // this account is already a member of, or creates a brand-new one if
  // it's a member of none; redeeming first is what makes it land on the
  // farm being joined instead of a fresh empty one.
  const [pendingInvite, setPendingInvite] = useState<string | null>(inviteLinkCode)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [skipInvite, setSkipInvite] = useState(false)
  const [retryCode, setRetryCode] = useState(inviteLinkCode ?? '')

  useEffect(() => {
    if (!session || !ready.data || !cutoverDone || !pendingInvite) return
    let live = true
    redeemInvite(pendingInvite).then(
      () => { if (live) { setInviteError(null); setPendingInvite(null) } },
      (e: Error) => { if (live) setInviteError(e.message) },
    )
    return () => { live = false }
  }, [session, ready.data, cutoverDone, pendingInvite])

  // Once signed in, make the local and remote farm identities agree. Syncing
  // before that would push records into the wrong farm. Held back while a
  // just-entered invite code is still being resolved — see above — so a bad
  // code can't be silently swallowed by falling through to a fresh farm;
  // "Continue without joining a farm" is the only way past a failed one.
  useEffect(() => {
    if (!session || !ready.data || !cutoverDone) return
    if (pendingInvite && !skipInvite) return
    let live = true
    linkFarm().then(
      (l) => { if (live) setLink(l) },
      (e: Error) => { if (live) setLinkError(e.message) },
    )
    return () => { live = false }
  }, [session, ready.data, cutoverDone, pendingInvite, skipInvite])

  const linked = link?.state === 'linked' || link?.state === 'created'
  const sync = useSync(Boolean(session) && linked && cutoverDone)

  // Setup runs once, and only for a farm this sign-in actually created.
  // A second device adopts an existing farm — state 'linked' — and skips it.
  const setupDone = useAsync(async () => (await getSyncState('setup')) === 'done', [])
  const [justSetUp, setJustSetUp] = useState(false)
  // Dev-only escape hatch — lets onboarding be re-previewed on a farm that
  // already has one, since a real farm only ever sees it once.
  const forceSetup = import.meta.env.DEV
    && new URLSearchParams(location.search).has('forcesetup')
  const needsSetup =
    (forceSetup || (link?.state === 'created' && setupDone.data === false)) && !justSetUp

  if (ready.error) {
    return (
      <main className="screen">
        <h1>FarmHand</h1>
        <p className="error">
          The local database failed to open. {ready.error.message}
        </p>
      </main>
    )
  }

  if (ready.loading || checking) {
    return (
      <main className="screen boot">
        <h1>FarmHand</h1>
        <p className="muted">Setting up your local database…</p>
      </main>
    )
  }

  // Takes priority over the signed-in checks below — the recovery link
  // signs the browser in as a side effect of proving the email is theirs,
  // but that shouldn't drop them straight into the app with the old
  // password's session still effectively "current".
  if (recovery) return <ResetPassword onDone={clearRecovery} />

  if (supabaseConfigured && !session)
    return (
      <SignIn
        linkError={badLink}
        onDismissLinkError={clearLinkError}
        onInviteCode={(code) => { setSkipInvite(false); setPendingInvite(code) }}
      />
    )

  if (cutover === null) {
    return (
      <main className="screen boot">
        <h1>FarmHand</h1>
        <p className="muted">Finishing an update…</p>
      </main>
    )
  }

  if (cutover.ok === false) {
    return (
      <main className="screen">
        <h1>FarmHand</h1>
        <p className="error">
          {cutover.reason === 'offline'
            ? "Connect to the internet to finish updating — some records haven't synced yet."
            : `Finishing the update failed: ${cutover.message}`}
        </p>
        <button className="primary" onClick={() => setCutoverTick((n) => n + 1)}>
          Try again
        </button>
      </main>
    )
  }

  if (pendingInvite && !skipInvite) {
    return (
      <main className="screen boot">
        <h1>FarmHand</h1>
        {!inviteError ? (
          <p className="muted">Joining your invited farm…</p>
        ) : (
          <>
            <p className="error">That invite code didn't work: {inviteError}</p>
            <label className="field">
              <span>Invite code</span>
              <input value={retryCode} onChange={(e) => setRetryCode(e.target.value)} />
            </label>
            <button className="primary" disabled={!retryCode.trim()} onClick={() => {
              setInviteError(null)
              setPendingInvite(retryCode.trim())
            }}>
              Try again
            </button>
            <button className="linkish" onClick={() => setSkipInvite(true)}>
              Continue without joining a farm
            </button>
          </>
        )}
      </main>
    )
  }

  if (needsSetup) {
    return (
      <Setup onDone={async () => {
        await setSyncState('setup', 'done')
        setJustSetUp(true)
      }} />
    )
  }

  if (showSettings) return <Settings onClose={() => setShowSettings(false)} />

  return (
    <div className="app">
      {import.meta.env.DEV && (
        <button className="devreset" onClick={async () => {
          if (!confirm('Wipe this farm back to blank and restart onboarding?')) return
          await resetFarmForTesting()
          location.href = '/?forcesetup=1'
        }}>
          Reset (dev)
        </button>
      )}
      {!supabaseConfigured && (
        <div className="banner">
          Local only — no account. Add Supabase keys to <code>.env</code> to sync.
        </div>
      )}
      {linkError && <div className="banner warn">Sync setup failed: {linkError}</div>}
      {link?.state === 'conflict' && (
        <div className="banner warn">
          This device has records under a different farm. Nothing was changed —
          they will not sync.
        </div>
      )}
      {linked && (
        <SyncBar
          status={sync.status}
          pending={sync.pending}
          last={sync.last}
          error={sync.error}
          onSync={sync.sync}
        />
      )}

      <main className="content">
        {tab === 'today' && <Today onGoToStock={() => setTab('animals')} />}
        {tab === 'animals' && <Animals />}
        {tab === 'stores' && <Stores />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'records' && <Records />}
      </main>

      {session && (
        <p className="account">
          <FarmName />
          <span className="account-sep">·</span>
          {session.user.email}
          {supabaseConfigured && (
            <button className="linkish" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          )}
          <button className="linkish" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </button>
        </p>
      )}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="glyph">{t.glyph}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
