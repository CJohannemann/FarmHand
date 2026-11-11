/**
 * A project's spending by kind, and inside each kind by what was bought:
 *
 *   Building supplies   $2,083.30
 *     gates               $259.98
 *     From Lowe's       $1,583.34
 *
 * The kind is the short list totals and the tax export add up by; the item
 * is the detail ("gates") that would otherwise have to become a kind of its
 * own. A purchase named only by its kind ("Paid for Building supplies")
 * says nothing more than its heading, so it is shown by its store instead.
 *
 * Pure, so db/test/verify-project-breakdown.ts can pin it down.
 */
export interface BreakdownRow {
  material: string | null
  item: string | null
  supplier: string | null
  price: number | null
}

export interface KindGroup {
  kind: string
  total: number
  /** [label, total], largest first. */
  items: [string, number][]
}

const NOT_RECORDED = 'Not recorded'

export function itemLabel(r: BreakdownRow): string {
  const kind = r.material?.trim() || NOT_RECORDED
  const item = r.item?.trim()
  if (item && item.toLowerCase() !== kind.toLowerCase()) return item
  const store = r.supplier?.trim()
  return store ? `From ${store}` : 'Not named'
}

export function byKindAndItem(rows: BreakdownRow[]): KindGroup[] {
  const groups = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const kind = r.material?.trim() || NOT_RECORDED
    const items = groups.get(kind) ?? new Map<string, number>()
    groups.set(kind, items)
    // Same item, differently cased ("Gates", "gates"), is one line.
    const label = itemLabel(r)
    const key = [...items.keys()].find((k) => k.toLowerCase() === label.toLowerCase()) ?? label
    items.set(key, (items.get(key) ?? 0) + (r.price ?? 0))
  }
  const cents = (n: number) => Math.round(n * 100) / 100
  return [...groups].map(([kind, items]) => {
    const list = [...items].map(([k, v]) => [k, cents(v)] as [string, number]).sort((a, b) => b[1] - a[1])
    return { kind, total: cents(list.reduce((t, [, v]) => t + v, 0)), items: list }
  }).sort((a, b) => b.total - a.total)
}
