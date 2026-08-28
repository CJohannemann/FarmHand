import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { costEntries } from '../db/queries'
import {
  bucketize, bucketEnd, materialBreakdown, rangeLabel,
  BUCKET_COUNT, type Granularity,
} from '../lib/periods'
import { formatMoney } from '../lib/numeric'
import { CostChart } from './CostChart'
import { Records } from './Records'
import { Receipts } from './Receipts'
import { PastStock } from './PastStock'

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
]

type View = 'costs' | 'records' | 'receipts' | 'stock'

const VIEWS: { id: View; label: string; title: string; tagline: string }[] = [
  { id: 'costs', label: 'Costs', title: 'Analytics',
    tagline: 'What your farm has cost you, by period.' },
  { id: 'records', label: 'Records', title: 'Records',
    tagline: 'Everything, newest first. Tap one to fix it.' },
  { id: 'receipts', label: 'Receipts', title: 'Receipts',
    tagline: 'Filed by tax year. Export a year when it is time to do the books.' },
  { id: 'stock', label: 'Past stock', title: 'Past stock',
    tagline: 'What the farm ran each year, and what became of it.' },
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

      {view === 'records' ? <Records />
        : view === 'receipts' ? <Receipts />
        : view === 'stock' ? <PastStock />
        : <Costs />}
    </div>
  )
}

function Costs() {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [selected, setSelected] = useState(BUCKET_COUNT.month - 1)
  const { data: entries, loading } = useAsync(() => costEntries(), [])

  // While `loading`, this renders as one short "Loading…" line; the chart
  // and category list appear right after, growing the page. On iOS Safari,
  // a scroll gesture that started (or landed) right around that moment
  // keeps the old, shorter height as its rubber-band limit until the finger
  // lifts and a new gesture begins — which reads as "can't reach the
  // footer, then immediately can." Forcing a reflow right as the content
  // arrives makes WebKit re-measure the page instead of waiting for that
  // next gesture.
  useEffect(() => {
    if (loading) return
    // Toggling overflow (not just reading offsetHeight) is what actually
    // makes WebKit resync its touch-scroll bounds here — a plain forced
    // reflow doesn't reach the compositor thread that owns those. Restores
    // whatever was there before rather than assuming '', so this can't
    // clobber a real overflow lock (a scroll-locked modal, say) some other
    // feature sets around the same moment this fires.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => { document.body.style.overflow = prev })
  }, [loading])

  const buckets = useMemo(
    () => bucketize(entries ?? [], granularity),
    [entries, granularity],
  )

  // A fresh granularity has its own bucket count — land back on "now".
  useEffect(() => { setSelected(BUCKET_COUNT[granularity] - 1) }, [granularity])

  const idx = Math.min(selected, buckets.length - 1)
  const active = buckets[idx]

  const spentBy = useMemo(
    () => (entries && active
      ? materialBreakdown(entries, active.start, bucketEnd(active.start, granularity), 'purchase')
      : []),
    [entries, active, granularity],
  )
  const earnedBy = useMemo(
    () => (entries && active
      ? materialBreakdown(entries, active.start, bucketEnd(active.start, granularity), 'sale')
      : []),
    [entries, active, granularity],
  )
  // Only once something has actually sold. Until then this is a costs page,
  // and dressing it up with an empty income column and a net that is just
  // minus-the-total helps nobody.
  const anyIncome = (entries ?? []).some((e) => e.kind === 'sale')

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
            {anyIncome ? (
              <>
                <span className={`stat-value ${active.net < 0 ? 'net-down' : 'net-up'}`}>
                  {active.net < 0 ? '−' : '+'}{formatMoney(Math.abs(active.net))}
                </span>
                <span className="stat-label">
                  {active.net < 0 ? 'down' : 'up'} over {rangeLabel(active.start, granularity)}
                </span>
              </>
            ) : (
              <>
                <span className="stat-value">{formatMoney(active.total)}</span>
                <span className="stat-label">{rangeLabel(active.start, granularity)}</span>
              </>
            )}
          </div>

          <CostChart buckets={buckets} granularity={granularity}
            selected={idx} onSelect={setSelected} />

          {anyIncome && earnedBy.length > 0 && (
            <>
              <h2 className="section">Money in</h2>
              <div className="costbox">
                {earnedBy.map((b) => (
                  <div className="costrow" key={b.material}>
                    <span>{b.material}</span>
                    <span className="net-up">{formatMoney(b.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 className="section">{anyIncome ? 'Money out' : 'By category'}</h2>
          {spentBy.length === 0 ? (
            <p className="hint">Nothing bought in this period.</p>
          ) : (
            <div className="costbox">
              {spentBy.map((b) => (
                <div className="costrow" key={b.material}>
                  <span>{b.material}</span>
                  <span>{formatMoney(b.total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
