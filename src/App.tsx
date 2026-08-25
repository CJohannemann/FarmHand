import { useEffect, useState } from 'react'
import { useAsync } from './lib/useAsync'
import { useSession } from './lib/useSession'
import { useSync } from './lib/useSync'
import { supabase, supabaseConfigured } from './lib/supabase'
import { linkFarm, type FarmLink } from './lib/farm'
import { db, getSyncState, setSyncState } from './db/client'
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
  const { session, checking, recovery, clearRecovery } = useSession()
  const [link, setLink] = useState<FarmLink | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const ready = useAsync(async () => { await db(); return true }, [])

  // Once signed in, make the local and remote farm identities agree. Syncing
  // before that would push records into the wrong farm.
  useEffect(() => {
    if (!session || !ready.data) return
    linkFarm().then(setLink, (e: Error) => setLinkError(e.message))
  }, [session, ready.data])

  const linked = link?.state === 'linked' || link?.state === 'created'
  const sync = useSync(Boolean(session) && linked)

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

  if (supabaseConfigured && !session) return <SignIn />

  if (needsSetup) {
    return (
      <Setup onDone={async () => {
        await setSyncState('setup', 'done')
        setJustSetUp(true)
      }} />
    )
  }

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
