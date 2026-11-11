/**
 * The kinds of thing a farm buys, as the Buy sheet offers them.
 *
 * Pure, so db/test/verify-quick-buy.ts can pin the naming rules down.
 */

/**
 * Work on the place rather than stock: recorded as money spent, never as
 * something on hand in Stores to be drawn down. A load of lumber is gone
 * into the barn the day it arrives; a power bill was never stock at all.
 */
export const SERVICE_MATERIALS = ['Improvements', 'Utilities', 'Building supplies']

/**
 * The quick Buy sheet's one-tap kinds — what most receipts are. Everything
 * else is one more tap away under "Something else".
 */
export const QUICK_KINDS = ['Feed', 'Hay', 'Building supplies', 'Medicine', 'Fuel', 'Parts']

/** Kinds whose purchases are for one kind of stock — see CATEGORIZABLE_MATERIALS. */
export const FOR_STOCK_KINDS = ['Feed', 'Hay', 'Mineral']

/**
 * What a purchase entered on the quick sheet is called, so nobody has to
 * type a name — and so two people buying the same thing get the same one.
 * "Pig feed" whoever buys it, rather than "Hog feed" from one of them and
 * "Pig feed" from the other; Stores and the Feed picker list by this name.
 *
 * Feed for pigs is "Pig feed"; hay with no animal named is "Hay"; anything
 * else is just its kind. The species is lower-cased into the phrase only
 * after its first letter, so "Pig feed", not "Pig Feed".
 */
export function quickPurchaseName(kind: string, forSpecies?: string | null): string {
  const k = kind.trim()
  const sp = forSpecies?.trim()
  if (sp && FOR_STOCK_KINDS.includes(k)) return `${sp} ${k.toLowerCase()}`
  return k
}

/**
 * A purchase's lot attributes once its kind is changed on Edit record.
 *
 * The kind is `material`. A category ("For: Pig") only means something on
 * feed, hay and mineral, so it goes with any other kind. Whether it is
 * stock or money spent on the place (origin, see SERVICE_MATERIALS)
 * follows the new kind — Building supplies re-filed as Feed shows up in
 * Stores, Feed re-filed as Building supplies leaves it — but only while
 * nothing has drawn on it: feed already fed out stays stock, and the cost
 * lot a vet visit was charged to stays one.
 */
export function purchaseKindChange(
  attrs: Record<string, unknown>, kind: string, drawnOn: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...attrs, material: kind }
  if (!FOR_STOCK_KINDS.includes(kind)) delete next.category
  const origin = (attrs.origin as string | undefined) ?? 'purchased'
  if (!drawnOn && (origin === 'purchased' || origin === 'service')) {
    next.origin = SERVICE_MATERIALS.includes(kind) ? 'service' : 'purchased'
  }
  return next
}

/** What the record of buying `item` is called: "Paid for gates", "Bought Pig feed". */
export function purchaseLogName(origin: unknown, item: string): string {
  return origin === 'service' ? `Paid for ${item.trim()}` : `Bought ${item.trim()}`
}
