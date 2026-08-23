import { useEffect, useState } from 'react'
import { useAsync } from './lib/useAsync'
import { useSession } from './lib/useSession'
import { useSync } from './lib/useSync'
import { supabase, supabaseConfigured } from './lib/supabase'
import { linkFarm, type FarmLink } from './lib/farm'
import { db } from './db/client'
import { Today } from './screens/Today'
import { Animals } from './screens/Animals'
import { Records } from './screens/Records'
import { SignIn } from './screens/SignIn'
import { SyncBar } from './screens/SyncBar'

type Tab = 'today' | 'animals' | 'records'

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today',   label: 'Today',   glyph: '☀️' },
  { id: 'animals', label: 'Stock',   glyph: '🐄' },
  { id: 'records', label: 'Records', glyph: '📋' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const { session, checking } = useSession()
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

  if (supabaseConfigured && !session) return <SignIn />

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
        {tab === 'today' && <Today />}
        {tab === 'animals' && <Animals />}
        {tab === 'records' && <Records />}
      </main>

      {session && (
        <p className="account">
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
