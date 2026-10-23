import {
  formatMoney, hasNumericValue, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput,
  onNumericChange,
} from '../lib/numeric'

/**
 * How an animal's price is settled: a figure agreed now, or so much per lb
 * of hanging weight — the usual way a hog or a side of beef is sold, where
 * the number only exists once the butcher weighs the carcass, days after
 * the animal has left. Shared by the Sell tile on Today and Close out on
 * the animal's own page, so the two ways in record the same sale.
 */
export interface AnimalSaleDraft {
  mode: 'price' | 'weight'
  price: string
  rate: string
  fee: string
}

export const EMPTY_ANIMAL_SALE: AnimalSaleDraft = { mode: 'price', price: '', rate: '', fee: '' }

/** What sellAsset() takes from the draft. */
export function animalSaleInput(d: AnimalSaleDraft): {
  price?: number; hangingRate?: number; processingFee?: number
} {
  if (d.mode === 'weight') {
    return {
      hangingRate: Number(d.rate),
      processingFee: hasNumericValue(d.fee) ? Number(d.fee) : undefined,
    }
  }
  return { price: hasNumericValue(d.price) ? Number(d.price) : undefined }
}

/** By weight needs its rate — without one there is nothing to work the
 * price out from once the weight comes back. A plain price may be blank. */
export function animalSaleReady(d: AnimalSaleDraft): boolean {
  return d.mode === 'price' || Number(d.rate) > 0
}

export function AnimalSaleFields({ draft, onDraft }: {
  draft: AnimalSaleDraft; onDraft: (d: AnimalSaleDraft) => void
}) {
  const set = (patch: Partial<AnimalSaleDraft>) => onDraft({ ...draft, ...patch })
  const numberProps = { onWheel: ignoreScrollOnNumberInput, onKeyDown: ignoreArrowKeysOnNumberInput }
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

      {draft.mode === 'price' ? (
        <label className="field">
          <span>What did you get for it? ($)</span>
          <input type="number" inputMode="decimal" min="0" value={draft.price}
            onChange={onNumericChange((v) => set({ price: v }))} {...numberProps}
            placeholder="450" />
          {/* Optional on purpose: an animal that left is a true record
              whether or not the cheque has been worked out yet, and
              demanding a number here just gets a made-up one. */}
          <small className="hint">
            Leave blank if you don't know yet — you can add it later under Records.
          </small>
        </label>
      ) : (
        <>
          <div className="pair">
            <label className="field">
              <span>Price per lb ($)</span>
              <input type="number" inputMode="decimal" min="0" value={draft.rate}
                onChange={onNumericChange((v) => set({ rate: v }))} {...numberProps}
                placeholder="4.50" />
            </label>
            <label className="field">
              <span>Processing fee ($, optional)</span>
              <input type="number" inputMode="decimal" min="0" value={draft.fee}
                onChange={onNumericChange((v) => set({ fee: v }))} {...numberProps}
                placeholder="0" />
            </label>
          </div>
          <small className="hint">
            It leaves the farm now and stops being fed. Today will remind you to
            enter the hanging weight when the butcher sends it, and works out the
            price{Number(draft.rate) > 0
              ? ` — 200 lb would come to ${formatMoney(Number(draft.rate) * 200
                + (Number(draft.fee) || 0))}` : ''}.
            Only add a processing fee if the buyer pays it to you, not the butcher.
          </small>
        </>
      )}
    </>
  )
}
