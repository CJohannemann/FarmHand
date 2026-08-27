/**
 * Open-Meteo reports WMO weather codes, not icons. This maps a code to a
 * single glyph so the forecast reads at a glance instead of as a table of
 * numbers.
 */
export function weatherIcon(code?: number): string {
  if (code == null) return '·'
  if (code === 0) return '☀️'
  if (code === 1 || code === 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️'
  if (code === 95 || code === 96 || code === 99) return '⛈️'
  return '☁️'
}

/**
 * A fixed hot/cold scale (not scaled to the week) so a mild week doesn't
 * paint itself as "hot" relative only to itself, the way it would with a
 * min/max normalized to that week's own range.
 */
export function colorForTemp(f: number): string {
  const clamped = Math.min(100, Math.max(20, f))
  const hue = 210 - ((clamped - 20) / 80) * 210
  return `hsl(${hue}, 70%, 55%)`
}
