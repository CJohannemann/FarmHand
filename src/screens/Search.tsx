import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  listAssets, listContacts, searchableLogs,
  type SearchableLog,
} from '../db/queries'
import type { Asset, Contact } from '../db/types'
import { rank } from '../lib/fuzzy'
import { logLabel, logDate } from './LogList'
import { useFarmTimezone } from '../lib/weather'
import { EditLog } from './EditLog'
import type { LogWithDetail } from '../db/types'

/** Enough rows to be useful, few enough to still be a shortlist. */
const PER_GROUP = 8

/**
 * One box for the whole farm.
 *
 * Everything on a farm is findable somewhere already — an animal under its
 * species card, a purchase under Records and the right year — but only if
 * you know where to look first and are willing to scroll. That gets worse
 * the longer the farm keeps records, which is backwards for a record book.
 *
 * Matching is forgiving on purpose: someone reaching for search is
 * half-remembering a name, not spelling it. See lib/fuzzy.
 */
export function Search({ onBack, onOpenAsset }: {
  onBack: () => void
  /** Opens one asset on the Inventory tab — animals, lots and machines alike. */
  onOpenAsset: (assetId: string) => void
}) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  const timeZone = useFarmTimezone()

  // Loaded once and scored in memory. Three queries rather than one union:
  // the row shapes genuinely differ, and flattening them into shared
  // columns only to pull them apart again in JS would be more code saying
  // less.
  const data = useAsync(async () => {
    const [assets, logs, contacts] = await Promise.all([
      listAssets(), searchableLogs(), listContacts(),
    ])
    return { assets, logs, contacts }
  }, [])

  const hits = useMemo(() => {
    if (!q.trim() || !data.data) return null
    const { assets, logs, contacts } = data.data
    // An asset is worth finding by its name or by what it is — "cattle"
    // should turn up the cows even though no cow is called that.
    const matchedAssets = rank(q, assets, (a) => [
      a.name,
      String(a.attributes?.species ?? ''),
      String(a.attributes?.material ?? ''),
      String(a.attributes?.kind ?? ''),
      String(a.attributes?.tag ?? ''),
    ])
    return {
      stock: matchedAssets.filter((a) => a.type !== 'lot'),
      stores: matchedAssets.filter((a) => a.type === 'lot'),
      logs: rank(q, logs, (l) => [l.name, l.subjects]),
      contacts: rank(q, contacts, (c) => [c.name, c.phone, c.email]),
    }
  }, [q, data.data])

  const total = hits
    ? hits.stock.length + hits.stores.length + hits.logs.length + hits.contacts.length
    : 0

  return (
    <div className="screen">
      <button className="back" onClick={onBack}>‹ Back</button>
      <h1>Search</h1>

      <label className="field">
        <span className="visually-hidden">Search</span>
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="An animal, a bag of feed, a purchase…" />
      </label>

      {data.loading && <p className="muted">Loading…</p>}

      {!q.trim() && !data.loading && (
        <p className="hint">
          Looks through your animals, what is in Stores, everything you have
          recorded, and your buyers. Near enough is good enough — "crkcorn"
          finds Cracked corn.
        </p>
      )}

      {hits && total === 0 && (
        <p className="empty">Nothing matches “{q.trim()}”.</p>
      )}

      {hits && (
        <>
          <Group label="Animals & land" rows={hits.stock}
            render={(a: Asset) => ({
              key: a.id,
              name: a.name,
              meta: [
                String(a.attributes?.species ?? a.attributes?.kind ?? a.type),
                a.status === 'archived' ? a.terminal_event ?? 'closed out' : '',
              ].filter(Boolean).join(' · '),
              onClick: () => onOpenAsset(a.id),
            })} />

          <Group label="Stores" rows={hits.stores}
            render={(a: Asset) => ({
              key: a.id,
              name: a.name,
              meta: String(a.attributes?.material ?? 'lot'),
              onClick: () => onOpenAsset(a.id),
            })} />

          <Group label="Records" rows={hits.logs}
            render={(l: SearchableLog) => ({
              key: l.id,
              name: l.name ?? logLabel(l.type),
              meta: [l.subjects, logDate(l.timestamp, timeZone)]
                .filter(Boolean).join(' · '),
              // The same sheet Today opens from its Recent list, so a
              // record found here can be corrected where it was found.
              //
              // Cast rather than fetched: EditLog reads exactly id, name,
              // notes, timestamp and type, and every one of those is real
              // here. The fields it never touches are left off rather than
              // invented — faking `notes` in particular would wipe the
              // note the moment anything was saved.
              onClick: () => setEditing(l as unknown as LogWithDetail),
            })} />

          {/* Buyers are not a link anywhere. There is no buyer page worth
              jumping to, and the thing actually wanted is the phone number
              — so the row hands it over rather than making someone tap
              through to read it. */}
          {hits.contacts.length > 0 && (
            <>
              <h2 className="section">Buyers</h2>
              <ul className="assetlist">
                {hits.contacts.slice(0, PER_GROUP).map((c: Contact) => (
                  <li key={c.id}>
                    <div className="assetrow static">
                      <span className="asset-name">{c.name}</span>
                      <span className="asset-meta">
                        {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
                        {c.phone && c.email ? ' · ' : ''}
                        {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {editing && (
        <EditLog log={editing} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); data.reload() }} />
      )}
    </div>
  )
}

/**
 * One titled run of results, capped.
 *
 * The tail of a ranked list is by definition the part nobody wants, so it
 * is counted rather than drawn — a hundred rows of near-misses would bury
 * the next group's real answer.
 */
function Group<T>({ label, rows, render }: {
  label: string
  rows: T[]
  render: (row: T) => { key: string; name: string; meta: string; onClick: () => void }
}) {
  if (rows.length === 0) return null
  const shown = rows.slice(0, PER_GROUP)
  return (
    <>
      <h2 className="section">{label}</h2>
      <ul className="assetlist">
        {shown.map((row) => {
          const r = render(row)
          return (
            <li key={r.key}>
              <button className="assetrow" onClick={r.onClick}>
                <span className="asset-name">{r.name}</span>
                <span className="asset-meta">
                  {r.meta}
                  <span className="chev">›</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length > shown.length && (
        <p className="hint">+ {rows.length - shown.length} more</p>
      )}
    </>
  )
}
