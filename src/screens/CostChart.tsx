import {
  axisLabel, money, niceMax, rangeLabel, ticksTo,
  type Bucket, type Granularity,
} from '../lib/periods'
import { formatMoney } from '../lib/numeric'

const W = 320
const H = 190
const PAD_L = 40
const PAD_R = 8
const PAD_T = 12
const PAD_B = 30

export type ChartMode = 'in' | 'out'

/**
 * One side of the ledger, per period. Money out, or money in — never both.
 *
 * Both together was tried and dropped. Drawn on one chart they are only
 * comparable while they are of similar size, and a farm's months rarely
 * are: $23,000 of spending against a $500 sale left the income side two
 * pixels tall, which is an honest picture and an unreadable one. Split, each
 * direction gets the full height and a scale of its own, and that same $500
 * fills half its chart.
 *
 * The geometry still works by allocating height from each side's peak, with
 * the suppressed side's peak set to zero. That puts the baseline flush
 * against the top edge for money out, or the bottom edge for money in, with
 * no separate single-series path to keep in step.
 */
export function CostChart({
  buckets, granularity, selected, onSelect, mode = 'out',
}: {
  buckets: Bucket[]
  granularity: Granularity
  selected: number
  onSelect: (i: number) => void
  /** Which side of the ledger to draw. Never both at once — see the header. */
  mode?: ChartMode
}) {
  if (buckets.length === 0) return null

  // Suppressing a side is just zeroing its peak: the split below already
  // gives each side room in proportion to its own maximum, so a maximum of
  // zero puts the line flush against the top or bottom edge and hands the
  // whole height to the other direction. No separate single-series path.
  const spentPeak = mode === 'in' ? 0 : Math.max(...buckets.map((b) => b.spent), 0)
  const earnedPeak = mode === 'in' ? Math.max(...buckets.map((b) => b.earned), 0) : 0
  // Rounded to clean ticks first, then divided — because earnH/earnMax and
  // spentH/spentMax both reduce to plotH/span, the two sides come out on an
  // identical scale despite having different amounts of room.
  const spentMax = spentPeak > 0 ? niceMax(spentPeak * 1.15) : 0
  const earnedMax = earnedPeak > 0 ? niceMax(earnedPeak * 1.15) : 0
  const span = spentMax + earnedMax || 1

  const n = buckets.length
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const earnedH = plotH * (earnedMax / span)
  const zeroY = PAD_T + earnedH
  const gap = 4
  const barW = Math.max((plotW - gap * (n - 1)) / n, 2)
  const x = (i: number) => PAD_L + i * (barW + gap)
  const barH = (v: number) => (v / span) * plotH

  const labelEvery = n <= 6 ? 1 : n <= 10 ? 2 : 3
  const active = buckets[selected]

  return (
    <div className="costchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* Steps up the active side, not just the baseline and the peak.
            With only those two, a bar reaching two thirds of the way up had
            nothing to be read against — you could see it was large and not
            how large. The inactive side has no scale to show, so it gets no
            rules at all rather than a mirror of zeros. */}
        {ticksTo(mode === 'in' ? earnedMax : spentMax).map((t) => {
          const signed = mode === 'in' ? t : -t
          const ty = zeroY - (signed / span) * plotH
          const isZero = t === 0
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={ty} y2={ty}
                stroke="var(--line)" strokeWidth={isZero ? 1.5 : 1}
                // The baseline is structure; the rest are a reference the
                // bars have to stay readable through.
                opacity={isZero ? 1 : 0.55} />
              <text x={PAD_L - 6} y={ty} textAnchor="end" dominantBaseline="middle"
                className="chart-tick">{money(t)}</text>
            </g>
          )
        })}

        {buckets.map((b, i) => {
          const bx = x(i)
          const on = i === selected
          const inH = mode !== 'out' && b.earned > 0 ? Math.max(barH(b.earned), 2) : 0
          const outH = mode !== 'in' && b.spent > 0 ? Math.max(barH(b.spent), 2) : 0
          return (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <g key={i} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}>
              {/* Full-height hit area: the bars themselves are too thin to
                  tap reliably with a thumb, and an empty period has none. */}
              <rect x={bx - gap / 2} y={PAD_T} width={barW + gap} height={plotH}
                fill="transparent" />
              {inH > 0 && (
                <rect x={bx} y={zeroY - inH} width={barW} height={inH} rx={2}
                  className={on ? 'bar-in on' : 'bar-in'} />
              )}
              {outH > 0 && (
                <rect x={bx} y={zeroY} width={barW} height={outH} rx={2}
                  className={on ? 'bar-out on' : 'bar-out'} />
              )}
              {i % labelEvery === 0 && (
                <text x={bx + barW / 2} y={H - PAD_B + 16} textAnchor="middle"
                  className="chart-tick">
                  {axisLabel(b.start, granularity)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* The only reading of the selected period on the screen — there used
          to be a large headline above repeating this exact figure. Coloured
          to match its own bars. The net lives in its own panel now, reached
          from the third chip. */}
      <p className="chart-tooltip">
        <strong className={mode === 'in' ? 'net-up' : 'net-down'}>
          {formatMoney(mode === 'in' ? active.earned : active.spent)}
        </strong>
        {' · '}{rangeLabel(active.start, granularity)}
      </p>
    </div>
  )
}
