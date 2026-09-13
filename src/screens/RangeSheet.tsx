import { RANGES, type RangeId } from '../lib/periods'
import { Sheet } from './Sheet'

/**
 * Which window the Costs view is reading — the eight presets, one tap each.
 *
 * A sheet rather than another row of chips: eight of them wrap into three
 * rows on a phone and push the chart off the screen, and this is a choice
 * made occasionally rather than flicked between. The row it opens from
 * names the current range and its real dates, which is the whole fix — the
 * old chips set bar width and left the window to be inferred from the axis.
 */
export function RangeSheet({ current, onPick, onClose }: {
  current: RangeId
  onPick: (id: RangeId) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Date range" onClose={onClose}>
      <ul className="assetlist">
        {RANGES.map((r) => (
          <li key={r.id}>
            <button className="assetrow" onClick={() => { onPick(r.id); onClose() }}>
              <span className="asset-name">{r.label}</span>
              <span className="asset-meta">
                {r.id === current ? '✓' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
