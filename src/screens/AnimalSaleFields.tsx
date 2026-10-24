import type { Dispatch, SetStateAction } from 'react'
import type { Contact } from '../db/types'
import type { SalePart } from '../db/queries'
import {
  formatMoney, hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'
import { SHARE_OPTIONS, shareLabel } from '../lib/saleCost'
import { BuyerSelect, EMPTY_BUYER_DRAFT, resolveBuyer, type BuyerDraft } from './BuyerSelect'

/**
 * How an animal's sale is settled, and with whom.
 *
 * The price is either a figure agreed now, or so much per lb of hanging
 * weight — the usual way a hog or a side of beef is sold, where the number
 * only exists once the butcher weighs the carcass, days after the animal
 * has left. Either way it can go to one buyer or be split between several:
 * two families taking half a hog each is the common case.
 *
 * Shared by the Sell tile on Today and Close out on the animal's own page,
 * so the two ways in record the same sale.
 */
export interface SalePartDraft {
  buyerId: string
  buyerDraft: BuyerDraft
  /** Fraction of the animal, as a string so it can drive a <select>. */
  share: string
  price: string
  fee: string
}

export interface AnimalSaleDraft {
  mode: 'price' | 'weight'
  rate: string
  parts: SalePartDraft[]
}

const part = (share: number): SalePartDraft =>
  ({ buyerId: '', buyerDraft: EMPTY_BUYER_DRAFT, share: String(share), price: '', fee: '' })

export const EMPTY_ANIMAL_SALE: AnimalSaleDraft = { mode: 'price', rate: '', parts: [part(1)] }

const totalShare = (d: AnimalSaleDraft) => d.parts.reduce((t, p) => t + Number(p.share), 0)

/** What sellAsset() takes from the draft, buyers typed fresh saved first. */
export async function animalSaleInput(d: AnimalSaleDraft, contacts: Contact[]): Promise<{
  hangingRate?: number; parts: SalePart[]
}> {
  const parts: SalePart[] = []
  for (const p of d.parts) {
    parts.push({
      buyer: await resolveBuyer(contacts, p.buyerId, p.buyerDraft),
      share: Number(p.share),
      ...(d.mode === 'weight'
        ? { processingFee: hasNumericValue(p.fee) ? Number(p.fee) : undefined }
        : { price: hasNumericValue(p.price) ? Number(p.price) : undefined }),
    })
  }
  return { hangingRate: d.mode === 'weight' ? Number(d.rate) : undefined, parts }
}

/**
 * By weight needs its rate — without one there is nothing to work the price
 * out from once the weight comes back. A set price may be left blank. The
 * shares cannot add to more than the animal; less is fine, for the half a
 * hog kept for the farm's own freezer.
 */
export function animalSaleReady(d: AnimalSaleDraft): boolean {
  if (d.mode === 'weight' && !(Number(d.rate) > 0)) return false
  return totalShare(d) <= 1.001
}

export function AnimalSaleFields({ draft, onDraft, contacts }: {
  draft: AnimalSaleDraft; onDraft: Dispatch<SetStateAction<AnimalSaleDraft>>; contacts: Contact[]
}) {
  // Updaters, not values: BuyerSelect sets the buyer and clears its draft in
  // one handler, and two writes built from the same render's `draft` let
  // the second undo the first — the buyer picked, then silently unpicked.
  const set = (patch: Partial<AnimalSaleDraft>) => onDraft((d) => ({ ...d, ...patch }))
  const setPart = (i: number, patch: Partial<SalePartDraft>) => onDraft((d) => ({
    ...d, parts: d.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)),
  }))
  // Adding a buyer splits the animal evenly between everyone on it — the
  // usual deal, and a starting point for anything else.
  const addBuyer = () => {
    const n = draft.parts.length + 1
    set({ parts: [...draft.parts, part(1 / n)].map((p) => ({ ...p, share: String(1 / n) })) })
  }
  const removeBuyer = (i: number) => {
    const rest = draft.parts.filter((_, j) => j !== i)
    set({ parts: rest.length === 1 ? [{ ...rest[0], share: '1' }] : rest })
  }
  const numberProps = { onWheel: ignoreScrollOnNumberInput, onKeyDown: ignoreArrowKeysOnNumberInput }
  const split = draft.parts.length > 1
  const total = totalShare(draft)
  const rate = Number(draft.rate)

  return (
    <>
      <div className="chipwrap" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className={draft.mode === 'price' ? 'chip on' : 'chip'}
          onClick={() => set({ mode: 'price' })}>
          Set price
        </button>
        <button type="button" className={draft.mode === 'weight' ? 'chip on' : 'chip'}
          onClick={() => set({ mode: 'weight' })}>
          By hanging weight
        </button>
      </div>

      {draft.mode === 'weight' && (
        <label className="field">
          <span>Price per lb ($)</span>
          <input type="number" inputMode="decimal" min="0" value={draft.rate}
            onChange={onNumericChange((v) => set({ rate: v }))} {...numberProps}
            placeholder="4.50" />
        </label>
      )}

      {draft.parts.map((p, i) => (
        <div key={i} className={split ? 'costbox' : undefined}
          style={split ? { padding: '0.75rem', marginBottom: '0.75rem' } : undefined}>
          {split && (
            <div className="screenhead" style={{ marginBottom: '0.5rem' }}>
              <strong>Buyer {i + 1}</strong>
              <button type="button" className="linkish" onClick={() => removeBuyer(i)}>Remove</button>
            </div>
          )}
          <BuyerSelect contacts={contacts} buyerId={p.buyerId}
            onBuyerId={(v) => setPart(i, { buyerId: v })}
            draft={p.buyerDraft} onDraft={(v) => setPart(i, { buyerDraft: v })} />
          <div className="pair">
            {split && (
              <label className="field">
                <span>Share</span>
                <select value={p.share} onChange={(e) => setPart(i, { share: e.target.value })}>
                  {/* The even split addBuyer() set, kept selectable even when
                      it is not one of the usual fractions (a fifth, say). */}
                  {!SHARE_OPTIONS.some((v) => Math.abs(v - Number(p.share)) < 0.001) && (
                    <option value={p.share}>{shareLabel(Number(p.share))}</option>
                  )}
                  {SHARE_OPTIONS.filter((v) => v < 1).map((v) => (
                    <option key={v} value={String(v)}>{shareLabel(v)}</option>
                  ))}
                </select>
              </label>
            )}
            {draft.mode === 'price' ? (
              <label className="field">
                <span>{split ? 'Price ($)' : 'What did you get for it? ($)'}</span>
                <input type="number" inputMode="decimal" min="0" value={p.price}
                  onChange={onNumericChange((v) => setPart(i, { price: v }))} {...numberProps}
                  placeholder={split ? '225' : '450'} />
              </label>
            ) : (
              <label className="field">
                <span>Processing fee ($, optional)</span>
                <input type="number" inputMode="decimal" min="0" value={p.fee}
                  onChange={onNumericChange((v) => setPart(i, { fee: v }))} {...numberProps}
                  placeholder="0" />
              </label>
            )}
          </div>
        </div>
      ))}

      <button type="button" className="linkish" style={{ marginBottom: '0.75rem' }}
        onClick={addBuyer}>
        + Split with another buyer
      </button>

      {total > 1.001 && (
        <p className="hint warn">
          The shares add up to more than the whole animal ({Math.round(total * 100)}%).
        </p>
      )}
      {split && total < 0.999 && (
        <p className="hint">
          {Math.round((1 - total) * 100)}% isn't sold to anyone — fine if you're keeping it.
        </p>
      )}

      {draft.mode === 'price' ? (
        /* Optional on purpose: an animal that left is a true record whether
           or not the cheque has been worked out yet, and demanding a number
           here just gets a made-up one. */
        <small className="hint">
          Leave a price blank if you don't know it yet — you can add it later under Records.
        </small>
      ) : (
        <small className="hint">
          It leaves the farm now and stops being fed. Today will remind you to
          enter the hanging weight when the butcher sends it, and works out what
          {split ? ' each buyer owes' : ' it comes to'}
          {rate > 0 ? ` — a 200 lb carcass at this rate is ${formatMoney(rate * 200)}` : ''}.
          Only add a processing fee if the buyer pays it to you, not the butcher.
        </small>
      )}
    </>
  )
}
