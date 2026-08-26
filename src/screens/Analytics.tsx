import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { costEntries } from '../db/queries'
import {
  bucketize, bucketEnd, materialBreakdown, rangeLabel,
  BUCKET_COUNT, type Granularity,
} from '../lib/periods'
import { CostChart } from './CostChart'
import { Records } from './Records'

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
]

type View = 'costs' | 'records'

const VIEWS: { id: View; label: string; title: string; tagline: string }[] = [
  { id: 'costs', label: 'Costs', title: 'Analytics',
    tagline: 'What your farm has cost you, by period.' },
  { id: 'records', label: 'Records', title: 'Records',
    tagline: 'Everything, newest first. Tap one to fix it.' },
]

/**
 * Costs and the raw log are one question — "what has happened here?" — asked
 * at two zoom levels, so they share a tab instead of sitting side by side in
 * the bar looking like two unrelated features.
 */
export function Analytics() {
  const [view, setView] = useState<View>('costs')
  const meta = VIEWS.find((v) => v.id === view)!

  return (
    <div className="screen">
      <h1>{meta.title}</h1>
      <p className="tagline">{meta.tagline}</p>

      <div className="chipwrap" style={{ marginBottom: '1.25rem' }}>
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? 'chip on' : 'chip'}
            onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'records' ? <Records /> : <Costs />}
    </div>
  )
}

function Costs() {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [selected, setSelected] = useState(BUCKET_COUNT.month - 1)
  const { data: entries, loading } = useAsync(() => costEntries(), [])

  const buckets = useMemo(
    () => bucketize(entries ?? [], granularity),
    [entries, granularity],
  )

  // A fresh granularity has its own bucket count — land back on "now".
  useEffect(() => { setSelected(BUCKET_COUNT[granularity] - 1) }, [granularity])

  const idx = Math.min(selected, buckets.length - 1)
  const active = buckets[idx]

  const breakdown = useMemo(
    () => (entries && active
      ? materialBreakdown(entries, active.start, bucketEnd(active.start, granularity))
      : []),
    [entries, active, granularity],
  )

  const hasAny = (entries?.length ?? 0) > 0

  return (
    <>
      <div className="chipwrap">
        {GRANULARITIES.map((g) => (
          <button key={g.id} className={granularity === g.id ? 'chip on' : 'chip'}
            onClick={() => setGranularity(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}

      {!loading && !hasAny && (
        <div className="empty" style={{ marginTop: '1rem' }}>
          Nothing bought yet — costs show up here once you log a purchase.
        </div>
      )}

      {hasAny && active && (
        <>
          <div className="stat">
            <span className="stat-value">${active.total.toFixed(2)}</span>
            <span className="stat-label">{rangeLabel(active.start, granularity)}</span>
          </div>

          <CostChart buckets={buckets} granularity={granularity}
            selected={idx} onSelect={setSelected} />

          <h2 className="section">By category</h2>
          {breakdown.length === 0 ? (
            <p className="hint">Nothing bought in this period.</p>
          ) : (
            <div className="costbox">
              {breakdown.map((b) => (
                <div className="costrow" key={b.material}>
                  <span>{b.material}</span>
                  <span>${b.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
