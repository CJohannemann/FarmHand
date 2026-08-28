import { axisLabel, rangeLabel, type Bucket, type Granularity } from '../lib/periods'
import { formatMoney } from '../lib/numeric'

const W = 320
const H = 190
const PAD_L = 40
const PAD_R = 8
const PAD_T = 12
const PAD_B = 30

/** Rounds a max value up to a clean tick — 42 -> 50, 340 -> 400. */
function niceMax(n: number) {
  if (n <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(n))
  const norm = n / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

const money = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

/**
 * Money in and money out, per period, around a shared zero line.
 *
 * Diverging rather than paired bars. Twelve months of two side-by-side bars
 * on a 320-wide chart gives each one about eight pixels, which is a smear
 * rather than a reading; above/below the line keeps the full bar width and
 * makes the only question that matters — is there more above or below —
 * answerable at a glance, without reading a single number.
 *
 * One pixels-per-dollar scale for both directions, so a $40 sale can never
 * be drawn the same size as a $4,000 one — but the zero line is NOT fixed
 * at the middle. It sits where each side's own peak puts it, so the two
 * halves divide the height in proportion to what actually happened.
 *
 * That split is load-bearing. A fixed midpoint looked reasonable until it
 * was rendered with real numbers: one $1,450 sale against $200-400 monthly
 * costs flattened every cost bar to a few pixels, making the routine
 * spending — the thing you look at most — unreadable. It also left half the
 * chart empty for a farm that has never recorded a sale at all.
 */
export function CostChart({
  buckets, granularity, selected, onSelect,
}: {
  buckets: Bucket[]
  granularity: Granularity
  selected: number
  onSelect: (i: number) => void
}) {
  if (buckets.length === 0) return null

  const spentPeak = Math.max(...buckets.map((b) => b.spent), 0)
  const earnedPeak = Math.max(...buckets.map((b) => b.earned), 0)
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
  const anyEarned = buckets.some((b) => b.earned > 0)

  return (
    <div className="costchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* Only each side's peak and the zero line: on a chart this small
            every extra rule costs more legibility than the reading it adds.
            A side with nothing in it gets no tick rather than a $0 label
            floating above an empty half. */}
        {[earnedMax, 0, -spentMax].filter((t, i) => i === 1 || t !== 0).map((t, i) => {
          const ty = zeroY - (t / span) * plotH
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={ty} y2={ty}
                stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={PAD_L - 6} y={ty} textAnchor="end" dominantBaseline="middle"
                className="chart-tick">{money(Math.abs(t))}</text>
            </g>
          )
        })}

        {buckets.map((b, i) => {
          const bx = x(i)
          const on = i === selected
          const inH = b.earned > 0 ? Math.max(barH(b.earned), 2) : 0
          const outH = b.spent > 0 ? Math.max(barH(b.spent), 2) : 0
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

      <p className="chart-tooltip">
        {anyEarned ? (
          <>
            <span className="swatch-in" /> in <strong>{formatMoney(active.earned)}</strong>
            {'  '}
            <span className="swatch-out" /> out <strong>{formatMoney(active.spent)}</strong>
            {'  ·  '}
            <strong className={active.net < 0 ? 'net-down' : 'net-up'}>
              {active.net < 0 ? '−' : '+'}{formatMoney(Math.abs(active.net))}
            </strong>
          </>
        ) : (
          // Before anything has ever sold, a legend and a net of exactly
          // minus-what-you-spent is just noise dressed as insight.
          <><strong>{formatMoney(active.spent)}</strong> · {rangeLabel(active.start, granularity)}</>
        )}
      </p>
    </div>
  )
}
