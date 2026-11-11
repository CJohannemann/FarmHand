/**
 * A scanned receipt (lib/receiptScan.ts) turned into what the Buy sheets
 * hold. Pure, so db/test/verify-receipt-scan.ts covers it.
 */
import { didYouMean, type NameUse } from './nameMatch.ts'
import { FOR_STOCK_KINDS, quickPurchaseName } from './purchaseKinds.ts'
import type { ScanResult } from './receiptScan.ts'

export interface ScanFill {
  cost: string
  kind: string
  /** The kind is off the quick sheet's one-tap list — open "Something else". */
  moreKinds: boolean
  forSpecies: string
  supplier: string
  /** YYYY-MM-DD, or '' when the receipt's date could not be read. */
  date: string
}

/**
 * The quick sheet's fields from a scan. A store already used is written
 * the farm's way ("LOWE'S" → "Lowe's", "Lowes" → "Lowe's"), so a scanned
 * receipt never starts a second spelling. Anything not read is left blank
 * for the person to fill in.
 */
export function quickFillFromScan(
  r: ScanResult, opts: { quickKinds: string[]; stores: NameUse[] },
): ScanFill {
  const store = r.store
    ? opts.stores.find((s) => s.name.toLowerCase() === r.store!.toLowerCase())?.name
      ?? didYouMean(r.store, opts.stores) ?? r.store
    : ''
  const kind = r.kind ?? ''
  return {
    cost: r.total != null ? r.total.toFixed(2) : '',
    kind,
    moreKinds: !!kind && !opts.quickKinds.includes(kind),
    forSpecies: kind && FOR_STOCK_KINDS.includes(kind) ? r.forSpecies ?? '' : '',
    supplier: store,
    date: r.date ?? '',
  }
}

/** One line of the detailed sheet — the same shape BuyForm keeps. */
export interface ScanLine {
  material: string
  category: string
  name: string
  amount: string
  unit: string
  cost: string
}

/**
 * Whether a receipt holds more than one kind of thing — feed and a water
 * heater — and so is worth splitting into lines rather than saved as one.
 */
export function isMixed(r: ScanResult): boolean {
  return new Set(r.items.map((i) => i.kind).filter(Boolean)).size > 1
}

/**
 * The detailed sheet's lines for a mixed receipt: one per kind, not one per
 * item — what the farm adds up is feed versus building supplies, and thirty
 * lines of screws and fittings would only be more to check. Items whose
 * kind wasn't read go with the receipt's own kind.
 *
 * The lines share out the receipt's total, tax included, in proportion to
 * what each kind's items came to, so they add up to what was paid to the
 * cent; the last line takes the rounding.
 */
export function linesFromScan(r: ScanResult): ScanLine[] {
  const byKind = new Map<string, number>()
  for (const it of r.items) {
    const k = it.kind ?? r.kind
    if (!k || it.amount == null) continue
    byKind.set(k, (byKind.get(k) ?? 0) + it.amount)
  }
  const kinds = [...byKind].sort((a, b) => b[1] - a[1])
  const sum = kinds.reduce((t, [, v]) => t + v, 0)
  if (kinds.length === 0 || sum <= 0) return []
  const total = r.total ?? sum
  let left = Math.round(total * 100)
  return kinds.map(([k, v], i) => {
    const cents = i === kinds.length - 1 ? left : Math.round((v / sum) * total * 100)
    left -= cents
    const species = FOR_STOCK_KINDS.includes(k) ? r.forSpecies ?? '' : ''
    return {
      material: k, category: species, name: quickPurchaseName(k, species),
      amount: '', unit: 'lb', cost: (cents / 100).toFixed(2),
    }
  })
}
