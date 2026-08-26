import { axisLabel, rangeLabel, type Bucket, type Granularity } from '../lib/periods'
import { formatMoney } from '../lib/numeric'

const W = 320
const H = 160
const PAD_L = 38
const PAD_R = 8
const PAD_T = 12
const PAD_B = 28

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
 * One bar per period, no legend — a single series, same reasoning as
 * GrowthChart. Selection stands in for hover on a touch device: tap a bar
 * to move the reading below the chart, defaulting to the most recent one.
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

  const maxV = niceMax(Math.max(...buckets.map((b) => b.total), 1) * 1.15)
  const n = buckets.length
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const gap = 4
  const barW = Math.max((plotW - gap * (n - 1)) / n, 2)
  const x = (i: number) => PAD_L + i * (barW + gap)
  const barH = (v: number) => (v / maxV) * plotH

  const ticks = [0, maxV / 2, maxV]
  const labelEvery = n <= 6 ? 1 : n <= 10 ? 2 : 3
  const active = buckets[selected]

  return (
    <div className="costchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {ticks.map((t, i) => {
          const ty = PAD_T + plotH - (t / maxV) * plotH
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={ty} y2={ty}
                stroke="var(--line)" strokeWidth={1} />
              <text x={PAD_L - 6} y={ty} textAnchor="end" dominantBaseline="middle"
                className="chart-tick">{money(t)}</text>
            </g>
          )
        })}

        {buckets.map((b, i) => {
          const bx = x(i)
          const bh = b.total > 0 ? Math.max(barH(b.total), 2) : 0
          const by = PAD_T + plotH - bh
          const on = i === selected
          return (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <g key={i} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}>
              <rect x={bx - gap / 2} y={PAD_T} width={barW + gap} height={plotH}
                fill="transparent" />
              {bh > 0 && (
                <rect x={bx} y={by} width={barW} height={bh} rx={3}
                  fill={on ? 'var(--accent)' : 'var(--line)'} />
              )}
              {i % labelEvery === 0 && (
                <text x={bx + barW / 2} y={H - PAD_B + 12} textAnchor="middle"
                  className="chart-tick">
                  {axisLabel(b.start, granularity)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="chart-tooltip">
        <strong>{formatMoney(active.total)}</strong> · {rangeLabel(active.start, granularity)}
      </p>
    </div>
  )
}
