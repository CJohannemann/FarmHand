import { useState } from 'react'
import { useAsync } from './lib/useAsync'
import { db } from './db/client'
import { assetCounts } from './db/queries'
import { Today } from './screens/Today'
import { Animals } from './screens/Animals'
import { Records } from './screens/Records'

type Tab = 'today' | 'animals' | 'records'

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today',   label: 'Today',   glyph: '☀️' },
  { id: 'animals', label: 'Stock',   glyph: '🐄' },
  { id: 'records', label: 'Records', glyph: '📋' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')

  // Opening the database also runs the schema on first launch.
  const ready = useAsync(async () => {
    await db()
    return assetCounts()
  }, [])

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

  if (ready.loading) {
    return (
      <main className="screen boot">
        <h1>FarmHand</h1>
        <p className="muted">Setting up your local database…</p>
      </main>
    )
  }

  return (
    <div className="app">
      <main className="content">
        {tab === 'today' && <Today />}
        {tab === 'animals' && <Animals />}
        {tab === 'records' && <Records />}
      </main>

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
