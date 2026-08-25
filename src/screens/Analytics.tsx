import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { costEntries } from '../db/queries'
import {
  bucketize, bucketEnd, materialBreakdown, rangeLabel,
  BUCKET_COUNT, type Granularity,
} from '../lib/periods'
import { CostChart } from './CostChart'

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
]

export function Analytics() {
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
    <div className="screen">
      <h1>Analytics</h1>
      <p className="tagline">What your farm has cost you, by period.</p>

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
    </div>
  )
}
