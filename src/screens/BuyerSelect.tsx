import type { Contact } from '../db/types'
import { createContact, listContacts } from '../db/queries'
import { OTHER } from './AssetSelect'

/** A buyer typed fresh, staged here until the parent form is actually saved. */
export interface BuyerDraft {
  name: string
  phone: string
  email: string
}

export const EMPTY_BUYER_DRAFT: BuyerDraft = { name: '', phone: '', email: '' }

/**
 * "Sold to?" — pick a buyer from past sales, or "Someone new" to type one in.
 * Same shape as ParentField's sire/dam picker: picking OTHER reveals a plain
 * form instead of a real record, and nothing is saved until the caller's own
 * Save (see resolveBuyer below) — an abandoned sale shouldn't leave a stray
 * buyer behind.
 *
 * A buyer needs three fields, not one name, so unlike ParentField this
 * doesn't wrap AssetSelect — a buyer isn't an asset at all (see contact's own
 * schema comment for why), just a flat list of names to choose from.
 */
export function BuyerSelect({
  contacts, buyerId, onBuyerId, draft, onDraft,
}: {
  contacts: Contact[]
  buyerId: string
  onBuyerId: (v: string) => void
  draft: BuyerDraft
  onDraft: (d: BuyerDraft) => void
}) {
  return (
    <>
      <label className="field">
        <span>Buyer (optional)</span>
        <select value={buyerId} onChange={(e) => {
          onBuyerId(e.target.value)
          if (e.target.value !== OTHER) onDraft(EMPTY_BUYER_DRAFT)
        }}>
          <option value="">— none —</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={OTHER}>Someone new</option>
        </select>
      </label>
      {buyerId === OTHER && (
        <>
          <label className="field">
            <span>Name</span>
            <input autoFocus value={draft.name}
              onChange={(e) => onDraft({ ...draft, name: e.target.value })}
              placeholder="The Harpers" />
          </label>
          <div className="pair">
            <label className="field">
              <span>Phone (optional)</span>
              <input type="tel" value={draft.phone}
                onChange={(e) => onDraft({ ...draft, phone: e.target.value })}
                placeholder="555-0123" />
            </label>
            <label className="field">
              <span>Email (optional)</span>
              <input type="email" value={draft.email}
                onChange={(e) => onDraft({ ...draft, email: e.target.value })}
                placeholder="harpers@example.com" />
            </label>
          </div>
        </>
      )}
    </>
  )
}

/**
 * Turns a BuyerSelect's picked-or-typed value into a name to save the sale
 * with, creating the contact first if it was typed fresh — called from the
 * parent form's own save(), never eagerly, so cancelling the sale never
 * leaves an orphaned buyer behind.
 *
 * Reuses an existing buyer of the same name rather than adding a second
 * one, the same way findOrCreateExternalParent does for an outside sire.
 * That is what makes a retry safe: useSave leaves the button live after a
 * failed save, and without this the second press would insert "The
 * Harpers" all over again alongside the first.
 */
export async function resolveBuyer(
  contacts: Contact[], buyerId: string, draft: BuyerDraft,
): Promise<string | undefined> {
  if (buyerId === OTHER) {
    const name = draft.name.trim()
    if (!name) return undefined
    // Read fresh rather than trusting the list this sheet opened with: on a
    // retry the contact from the failed attempt already exists but is not
    // in that copy, which is exactly the case this guards.
    const existing = (await listContacts()).find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase())
    if (existing) return existing.name
    await createContact({
      name,
      phone: draft.phone.trim() || undefined,
      email: draft.email.trim() || undefined,
    })
    return name
  }
  return contacts.find((c) => c.id === buyerId)?.name
}
