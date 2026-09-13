import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { useSave } from '../lib/useSave'
import { createContact, deleteContact, listContacts, updateContact } from '../db/queries'
import type { Contact } from '../db/types'
import { Sheet } from './Sheet'

/**
 * The buyer list a sale's "Buyer" field draws from — reachable on its own,
 * so a phone number can be looked up (or a typo fixed) without starting a
 * sale to get at it.
 *
 * Sits under Analytics rather than Settings, where it started. Settings is
 * this device and this account — a theme, who is on the farm, the way out.
 * Who you sell to is the farm's own records, which is what every other
 * view on this tab is.
 */
export function Buyers() {
  const contacts = useAsync(() => listContacts(), [])
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)

  return (
    <>
      {contacts.loading && <p className="muted">Loading…</p>}
      {contacts.data && contacts.data.length === 0 && (
        <p className="empty">
          Nobody yet — the "Buyer" field on a sale offers to add one on the spot.
        </p>
      )}
      {contacts.data && contacts.data.length > 0 && (
        <ul className="assetlist">
          {contacts.data.map((c) => (
            <li key={c.id}>
              <button className="assetrow" onClick={() => setEditing(c)}>
                <span className="asset-name">{c.name}</span>
                <span className="asset-meta">
                  {[c.phone, c.email].filter(Boolean).join(' · ')}
                  <span className="chev">›</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="linkish" onClick={() => setEditing('new')}>
        + Add a buyer
      </button>
      {editing && (
        <BuyerSheet
          contact={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); contacts.reload() }}
        />
      )}
    </>
  )
}

function BuyerSheet({ contact, onClose, onChanged }: {
  /** Omitted for a brand-new buyer. */
  contact?: Contact
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(contact?.name ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [notes, setNotes] = useState(contact?.notes ?? '')
  const [removing, setRemoving] = useState(false)

  const save = async () => {
    const fields = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
    }
    if (contact) await updateContact(contact.id, fields)
    else await createContact(fields)
    onChanged()
  }
  const { run, busy, error } = useSave(save)

  const remove = useSave(async () => { await deleteContact(contact!.id); onChanged() })

  return (
    <Sheet title={contact ? contact.name : 'Add a buyer'} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="The Harpers" />
      </label>
      <div className="pair">
        <label className="field">
          <span>Phone (optional)</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="555-0123" />
        </label>
        <label className="field">
          <span>Email (optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="harpers@example.com" />
        </label>
      </div>
      <label className="field">
        <span>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Pays cash, wants a dozen every Friday" />
      </label>
      <button className="primary" disabled={busy || !name.trim()} onClick={run}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {(error || remove.error) && <p className="error">{error ?? remove.error}</p>}
      {contact && (!removing ? (
        <button className="danger" onClick={() => setRemoving(true)}>Remove this buyer</button>
      ) : (
        <div className="confirm">
          <p>
            Remove {contact.name}? Past sales keep their name — this just
            takes them off the list for next time.
          </p>
          <div className="actions">
            <button onClick={() => setRemoving(false)}>Keep them</button>
            <button className="danger" disabled={remove.busy} onClick={remove.run}>Remove</button>
          </div>
        </div>
      ))}
    </Sheet>
  )
}
