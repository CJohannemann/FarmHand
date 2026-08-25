import { useRef, useState } from 'react'

interface WeightPoint { timestamp: string; value: number; unit: string }

const W = 320
const H = 160
const PAD_L = 30
const PAD_R = 12
const PAD_T = 16
const PAD_B = 20

/** Rounds a max value up to a clean tick — 42 -> 50, 340 -> 400. */
function niceMax(n: number) {
  if (n <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(n))
  const norm = n / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * A single line, no legend — one series needs none, the "Growth" heading
 * above it already says what's plotted. Colors ride the app's own --accent
 * token rather than a new palette: it is already contrast-checked for both
 * themes everywhere else in the app, so reusing it here adds no new risk.
 */
export function GrowthChart({ points }: { points: WeightPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) return null

  const unit = points[points.length - 1].unit
  const values = points.map((p) => p.value)
  const times = points.map((p) => new Date(p.timestamp).getTime())
  const minV = 0
  const maxV = niceMax(Math.max(...values) * 1.15)
  const minT = times[0]
  const maxT = times[times.length - 1]
  const spanT = Math.max(maxT - minT, 1)

  const x = (t: number) => PAD_L + ((t - minT) / spanT) * (W - PAD_L - PAD_R)
  const y = (v: number) => H - PAD_B - ((v - minV) / (maxV - minV)) * (H - PAD_T - PAD_B)

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(times[i]).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ')

  const ticks = [minV, maxV / 2, maxV]
  const lastX = x(times[times.length - 1])
  const lastY = y(values[values.length - 1])

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let nearest = 0
    let best = Infinity
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px)
      if (d < best) { best = d; nearest = i }
    })
    setHover(nearest)
  }

  const hp = hover != null ? points[hover] : null
  const hx = hover != null ? x(times[hover]) : 0
  const hy = hover != null ? y(hp!.value) : 0

  return (
    <div className="growthchart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)}
              stroke="var(--line)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t)} textAnchor="end" dominantBaseline="middle"
              className="chart-tick">{Math.round(t)}</text>
          </g>
        ))}

        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(times[i])} cy={y(p.value)} r={5} fill="var(--card)" />
            <circle cx={x(times[i])} cy={y(p.value)} r={3} fill="var(--accent)" />
          </g>
        ))}

        <text x={lastX - 8} y={lastY - 10} textAnchor="end" className="chart-endlabel">
          {values[values.length - 1]} {unit}
        </text>

        {hover != null && (
          <>
            <line x1={hx} x2={hx} y1={PAD_T} y2={H - PAD_B}
              stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={hx} cy={hy} r={5} fill="var(--card)" />
            <circle cx={hx} cy={hy} r={3} fill="var(--accent)" />
          </>
        )}

        <rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={H} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <p className="chart-tooltip">
        {hp
          ? <><strong>{hp.value} {hp.unit}</strong> · {dateFmt(hp.timestamp)}</>
          : <>{points.length} weigh-ins · touch the line for a date</>}
      </p>
    </div>
  )
}
