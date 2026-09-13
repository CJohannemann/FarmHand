import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { costEntries } from '../db/queries'
import {
  bucketsIn, materialBreakdown, rangeDates, resolveRange,
  type Bucket, type DateRange, type RangeId,
} from '../lib/periods'
import { RangeSheet } from './RangeSheet'
import { formatMoney } from '../lib/numeric'
import { CostChart, type ChartMode } from './CostChart'
import { Records } from './Records'
import { Receipts } from './Receipts'
import { PastStock } from './PastStock'

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

/**
 * Two of these draw the chart; Net replaces it. Kept as one row of chips
 * because from the reader's side they are the same choice — which reading
 * of this period am I looking at — even though one of them is not a chart.
 */
type Panel = ChartMode | 'net'

const MODES: { id: Panel; label: string }[] = [
  { id: 'out', label: 'Money out' },
  { id: 'in', label: 'Money in' },
  { id: 'net', label: 'Net' },
]

function Costs() {
  // Last 12 months is the closest preset to what this screen used to open
  // on (monthly bars, twelve of them), so it still looks familiar.
  const [rangeId, setRangeId] = useState<RangeId>('12m')
  const [pickingRange, setPickingRange] = useState(false)
  // One side at a time, never both together. Drawn on one chart they are
  // unreadable the moment they are lopsided — a month of $23,000 spent
  // against $500 earned leaves the income side two pixels tall — and money
  // out is what a farm looks at most, so it leads.
  const [mode, setMode] = useState<Panel>('out')
  const { data: entries, loading } = useAsync(() => costEntries(), [])

  // A body-overflow toggle used to live here, to make WebKit re-measure the
  // page's touch-scroll bounds after "Loading…" was replaced by the taller
  // chart. Both halves of that are gone: useAsync no longer blanks a screen
  // that already has data, and the signed-in shell scrolls an inner element
  // rather than the page, so there are no page-level scroll bounds left for
  // it to resync.

  // 'All time' reads the entries to find where the farm's records start, so
  // the range depends on them as well as on the preset.
  const range = useMemo(
    () => resolveRange(rangeId, entries ?? []),
    [rangeId, entries],
  )
  const buckets = useMemo(() => bucketsIn(entries ?? [], range), [entries, range])

  // Both breakdowns cover the whole range now, not a bucket someone tapped.
  // materialBreakdown already took an explicit start/end, so this needed no
  // change on its side.
  const spentBy = useMemo(
    () => (entries ? materialBreakdown(entries, range.from, range.to, 'purchase') : []),
    [entries, range],
  )
  const earnedBy = useMemo(
    () => (entries ? materialBreakdown(entries, range.from, range.to, 'sale') : []),
    [entries, range],
  )
  // Only once something has actually sold. Until then this is a costs page,
  // and dressing it up with an empty income column and a net that is just
  // minus-the-total helps nobody.
  const anyIncome = (entries ?? []).some((e) => e.kind === 'sale')

  const hasAny = (entries?.length ?? 0) > 0

  return (
    <>
      {/* Names the window and its real dates. The chips this replaced set
          how wide each bar was and never said what span was on screen, so
          "Week" drew twelve weekly bars across three months. */}
      <ul className="assetlist">
        <li>
          <button className="assetrow" onClick={() => setPickingRange(true)}>
            <span className="asset-name">{range.label}</span>
            <span className="asset-meta">
              {rangeDates(range)}
              <span className="chev">›</span>
            </span>
          </button>
        </li>
      </ul>

      {pickingRange && (
        <RangeSheet current={rangeId} onPick={setRangeId}
          onClose={() => setPickingRange(false)} />
      )}

      {loading && <p className="muted">Loading…</p>}

      {!loading && !hasAny && (
        <div className="empty" style={{ marginTop: '1rem' }}>
          Nothing bought yet — costs show up here once you log a purchase.
        </div>
      )}

      {hasAny && buckets.length > 0 && (
        <>
          {/* No headline figure here any more. It restated, in large type,
              the number the chart's own caption already gives — and once the
              caption took the colour and the net there was nothing left for
              it to say that was not said twice. */}

          {/* Only worth offering once there are two directions to separate.
              Before a first sale this would be a control with one real
              setting, on a screen that already carries two rows of chips. */}
          {anyIncome && (
            <div className="chipwrap modewrap">
              {MODES.map((m) => (
                <button key={m.id} className={mode === m.id ? 'chip on' : 'chip'}
                  onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {mode === 'net' ? (
            <NetPanel buckets={buckets} range={range} />
          ) : (
            <CostChart buckets={buckets} range={range} mode={mode} />
          )}

          {/* The breakdown follows the chips, same as the chart above it.
              It used to show both sides whatever was selected, which read
              as the screen ignoring you: picking Money in on a month with
              no sales left a chart saying $0.00 sitting on top of a list
              headed Money out, and nothing on screen answered the question
              actually asked. Net shows both, because that is what net is.

              An empty side now says so rather than silently vanishing —
              "nothing sold this month" is a real answer, and it is the one
              the missing list used to leave to guesswork. */}
          {anyIncome && (mode === 'in' || mode === 'net') && (
            <>
              <h2 className="section">Money in</h2>
              {earnedBy.length === 0 ? (
                <p className="hint">Nothing sold in this period.</p>
              ) : (
                <div className="costbox">
                  {earnedBy.map((b) => (
                    <div className="costrow" key={b.material}>
                      <span>{b.material}</span>
                      <span className="net-up">{formatMoney(b.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(!anyIncome || mode === 'out' || mode === 'net') && (
            <>
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
      )}
    </>
  )
}

/**
 * The period's net, in place of the chart.
 *
 * A chart of net would be a chart of one number per period with no scale
 * anyone could read against — the interesting thing about net is not its
 * shape over time but whether this period was up or down, and by how much.
 * So this is the figure, large, and the two sides it came from underneath
 * so the number is not just asserted.
 *
 * The period follows the same Week/Month/Quarter/Year chips as the chart,
 * and stays on whichever bar was last tapped over there — switching to Net
 * and back should not move you to a different month.
 */
function NetPanel({ buckets, range }: { buckets: Bucket[]; range: DateRange }) {
  // Summed over the whole range rather than read off one bucket — the range
  // is what the screen is reading now.
  const earned = buckets.reduce((t, b) => t + b.earned, 0)
  const spent = buckets.reduce((t, b) => t + b.spent, 0)
  const net = earned - spent
  const down = net < 0
  return (
    <div className="netpanel">
      <span className={`netpanel-value ${down ? 'net-down' : 'net-up'}`}>
        {down ? '−' : '+'}{formatMoney(Math.abs(net))}
      </span>
      <span className="netpanel-label">
        {down ? 'down' : 'up'} over {rangeDates(range)}
      </span>
      <span className="netpanel-parts">
        <strong className="net-up">{formatMoney(earned)}</strong> in
        {'  ·  '}
        <strong className="net-down">{formatMoney(spent)}</strong> out
      </span>
    </div>
  )
}
