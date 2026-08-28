import { axisLabel, niceMax, rangeLabel, type Bucket, type Granularity } from '../lib/periods'
import { formatMoney } from '../lib/numeric'

const W = 320
const H = 190
const PAD_L = 40
const PAD_R = 8
const PAD_T = 12
const PAD_B = 30


const money = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

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
        {/* The baseline and the one peak: on a chart this small every extra
            rule costs more legibility than the reading it adds. */}
        {[earnedMax, 0, -spentMax].filter((t, i) => i === 1 || t !== 0).map((t, i) => {
          const ty = zeroY - (t / span) * plotH
          // A side that got very little height puts its peak label right on
          // top of the zero one — $500 of income against $23,000 of spending
          // leaves them under three pixels apart, and both become unreadable.
          // The rule still gets drawn; only the number is dropped, and the
          // exact figures are in the line under the chart regardless.
          const crowded = t !== 0 && Math.abs(ty - zeroY) < 14
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={ty} y2={ty}
                stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} />
              {!crowded && (
                <text x={PAD_L - 6} y={ty} textAnchor="end" dominantBaseline="middle"
                  className="chart-tick">{money(Math.abs(t))}</text>
              )}
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

      {/* One direction, so no legend and no swatches — the chip above the
          chart already says which side is being read. */}
      <p className="chart-tooltip">
        <strong>{formatMoney(mode === 'in' ? active.earned : active.spent)}</strong>
        {' · '}{rangeLabel(active.start, granularity)}
      </p>
    </div>
  )
}
