import { useEffect, useState } from 'react'
import { useAsync } from './lib/useAsync'
import { useSession } from './lib/useSession'
import { useSync } from './lib/useSync'
import { supabase, supabaseConfigured } from './lib/supabase'
import { claimDeviceFor, linkFarm, type FarmLink } from './lib/farm'
import { redeemInvite } from './lib/members'
import { inviteLinkCode } from './lib/inviteLink'
import { navigate, useRoute } from './lib/route'
import { db, getSyncState, setSyncState } from './db/client'
import { consumeWipeIfPending, ensureCutover, type CutoverResult } from './db/cutover'
import { Today } from './screens/Today'
import { Stock } from './screens/Stock'
import { Analytics } from './screens/Analytics'
import { Landing } from './screens/Landing'
import { NotFound } from './screens/NotFound'
import { SignIn } from './screens/SignIn'
import { ResetPassword } from './screens/ResetPassword'
import { Setup, FarmName } from './screens/Setup'
import { Settings } from './screens/Settings'

type Tab = 'today' | 'stock' | 'analytics' | 'settings'

/**
 * Four, down from five plus a floating gear.
 *
 * Stores listed the same lots the Stock tab already did, one screen apart,
 * so it moved into Stock as the sections that carry a balance. Records was
 * the same records Analytics charts, so the two share a tab. What that
 * bought back is a slot for Settings, which had been a gear pinned over the
 * top-right corner of every screen — findable only by knowing it was there.
 */
const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today',     label: 'Today',     glyph: '☀️' },
  { id: 'stock',     label: 'Inventory', glyph: '🐄' },
  { id: 'analytics', label: 'Analytics', glyph: '📊' },
  { id: 'settings',  label: 'Settings',  glyph: '⚙️' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const { session, checking, recovery, clearRecovery, linkError: badLink, clearLinkError } = useSession()
  const route = useRoute()
  const [link, setLink] = useState<FarmLink | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const ready = useAsync(async () => { await consumeWipeIfPending(); await db(); return true }, [])

  /**
   * The three redirects the routes can't express on their own. Kept in an
   * effect rather than a navigate() mid-render, since changing history
   * while React is rendering is a side effect during a phase that is
   * supposed to be pure — and `replace` throughout, so none of these
   * automatic corrections land in history for the back button to walk
   * into and be bounced straight back out of.
   *
   * A shared invite link or a dead password-reset link is a direct request
   * to deal with an account, not an organic visit, so both skip the
   * marketing page the way they did before there were URLs to skip it with.
   */
  useEffect(() => {
    if (checking || recovery || !supabaseConfigured) return
    if (session && (route === '/login' || route === '/signup')) {
      navigate('/app', { replace: true })
    } else if (!session && route === '/app') {
      navigate('/login', { replace: true })
    } else if (!session && route === '/' && (inviteLinkCode || badLink)) {
      navigate(inviteLinkCode ? '/signup' : '/login', { replace: true })
    }
  }, [route, session, checking, recovery, badLink])

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
    // Before anything reads a local farm id: if this device still holds a
    // different account's records, they are wiped here. Otherwise linkFarm()
    // would hand them to whoever just signed in — create_farm() takes the
    // local farm id as its wanted_id, so a fresh account adopts the old farm
    // wholesale and pushes it up as its own.
    claimDeviceFor(session.user.id)
      .then(linkFarm)
      .then(
        (l) => { if (live) setLink(l) },
        (e: Error) => { if (live) setLinkError(e.message) },
      )
    return () => { live = false }
  }, [session, ready.data, cutoverDone, pendingInvite, skipInvite])

  const linked = link?.state === 'linked' || link?.state === 'created'
  // Return value unused — Settings' own panel reports sync state now; this
  // call is only for the polling/push-after-write/revocation-check side
  // effects it runs internally.
  useSync(Boolean(session) && linked && cutoverDone)

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

  // Only long enough to read a persisted session from local storage — not
  // gated on the local database, so it resolves before ready below does.
  if (checking) {
    return (
      <main className="screen boot">
        <h1>Farmhand Management</h1>
      </main>
    )
  }

  // Takes priority over the signed-in checks below — the recovery link
  // signs the browser in as a side effect of proving the email is theirs,
  // but that shouldn't drop them straight into the app with the old
  // password's session still effectively "current".
  // A recovery link lands on '/' (SignIn's resetPasswordForEmail sends them
  // to the origin), which is now the marketing page — so finishing the
  // reset hands them to their farm rather than dropping them back on the
  // pitch for a product they have just proved they own an account for.
  if (recovery) {
    return <ResetPassword onDone={() => { clearRecovery(); navigate('/app', { replace: true }) }} />
  }

  // Ahead of the landing page and the ready checks alike: an unrecognized
  // URL is answerable without a session or a local database, and making a
  // typo wait on database setup would be a slow way to say "no".
  if (route === 'not-found') {
    return <NotFound signedIn={Boolean(session)} onGo={(to) => navigate(to)} />
  }

  // '/' is the marketing page, for everyone — signed in or not. It is the
  // public front door of a hosted product, so it can't be a screen someone
  // loses access to by having an account; a signed-in reader gets the same
  // page with its CTAs pointing at their farm instead of at a sign-up form.
  //
  // Ahead of the ready checks below because it needs no local database: a
  // first-time visitor shouldn't wait on database setup meant for people
  // who are already signed in. (db() still starts opening in the background
  // on mount regardless — see the `ready` useAsync above — so it's
  // typically already warm by the time someone actually signs in.)
  if (supabaseConfigured && route === '/')
    return (
      <Landing
        signedIn={Boolean(session)}
        onSignIn={(mode) => navigate(mode === 'up' ? '/signup' : '/login')}
        onOpenApp={() => navigate('/app')}
      />
    )

  if (ready.error) {
    return (
      <main className="screen">
        <h1>Farmhand Management</h1>
        <p className="error">
          The local database failed to open. {ready.error.message}
        </p>
      </main>
    )
  }

  if (ready.loading) {
    return (
      <main className="screen boot">
        <h1>Farmhand Management</h1>
        <p className="muted">Setting up your local database…</p>
      </main>
    )
  }

  if (supabaseConfigured && !session)
    return (
      <SignIn
        linkError={badLink}
        onDismissLinkError={clearLinkError}
        onInviteCode={(code) => { setSkipInvite(false); setPendingInvite(code) }}
        initialMode={route === '/signup' ? 'up' : 'in'}
        // Keeps the address bar honest when someone switches forms with the
        // screen's own "No account yet?" link rather than by URL. 'forgot'
        // has no route of its own — it's a step within signing in, not a
        // place worth linking anyone to.
        onModeChange={(mode) => navigate(mode === 'up' ? '/signup' : '/login', { replace: true })}
      />
    )

  if (cutover === null) {
    return (
      <main className="screen boot">
        <h1>Farmhand Management</h1>
        <p className="muted">Finishing an update…</p>
      </main>
    )
  }

  if (cutover.ok === false) {
    return (
      <main className="screen">
        <h1>Farmhand Management</h1>
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
        <h1>Farmhand Management</h1>
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

  // Everything Settings holds — the farm name, sync, who else is on the
  // farm — needs an account behind it, so a local-only install has no tab
  // for it rather than a tab that can only apologise.
  const tabs = TABS.filter(
    (t) => t.id !== 'settings' || (session && supabaseConfigured),
  )
  const current = tabs.some((t) => t.id === tab) ? tab : 'today'

  return (
    <div className="app">
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
      <main className="content">
        {current === 'today' && <Today onGoToStock={() => setTab('stock')} />}
        {current === 'stock' && <Stock />}
        {current === 'analytics' && <Analytics />}
        {current === 'settings' && <Settings />}
      </main>

      {session && (
        <p className="account">
          <FarmName />
          <span className="account-sep">·</span>
          {session.user.email}
          <button className="linkish" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </button>
        </p>
      )}

      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={current === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            aria-current={current === t.id ? 'page' : undefined}
          >
            <span className="glyph">{t.glyph}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
