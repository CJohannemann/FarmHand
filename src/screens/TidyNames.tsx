import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { mergeNames, nameUsage } from '../db/queries'
import type { NameKind } from '../db/namesSql'
import { likelyDuplicates } from '../lib/nameMatch'

const KINDS: { id: NameKind; label: string; one: string; hint: string }[] = [
  { id: 'item', label: 'Items', one: 'item',
    hint: 'What bought things are called — what Stores and the Feed picker list.' },
  { id: 'store', label: 'Stores', one: 'store',
    hint: 'Where things were bought — what a project’s By store adds up by.' },
  { id: 'kind', label: 'Kinds', one: 'kind',
    hint: 'Feed, Hay, Building supplies… — what Costs adds up by.' },
]

/**
 * Settings' "Tidy up names": one name for one thing, after the fact.
 *
 * The Buy sheet now offers the name already in use, but everything bought
 * before that — "Hog feed" from one person, "Pig feed" from the other —
 * is still two names. This finds the pairs that look alike and merges one
 * into the other on a tap: the bags, their purchase records, a project's
 * store breakdown, all under the one name, on every device on the account.
 *
 * Nothing merges without a tap. Look-alikes are only suggestions — "Not
 * the same" hides one for now — and any name can be merged into any other
 * by hand from the full list.
 */
export function TidyNames() {
  const [kind, setKind] = useState<NameKind>('item')
  const { data: used, reload } = useAsync(() => nameUsage(kind), [kind])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [into, setInto] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const meta = KINDS.find((k) => k.id === kind)!

  const names = [...(used ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const pairs = likelyDuplicates(used ?? [])
    .filter((p) => !dismissed.includes(`${kind}:${p.from.name}→${p.into.name}`))

  const merge = async (from: string, to: string) => {
    setBusy(true)
    await mergeNames(kind, from, to)
    setBusy(false); setPicking(null); setInto('')
    setDone(`"${from}" is now "${to}".`)
    reload()
  }

  return (
    <>
      <h2 style={{ marginTop: '1.5rem' }}>Tidy up names</h2>
      <p className="hint">
        The same thing saved under two names — "Hog feed" and "Pig feed",
        "Lowes" and "Lowe's" — merged into one, everywhere it is used.
      </p>

      <div className="chipwrap" style={{ marginBottom: '0.5rem' }}>
        {KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'chip on' : 'chip'}
            onClick={() => { setKind(k.id); setPicking(null); setDone(null) }}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="hint">{meta.hint}</p>

      {done && <p className="notice">{done}</p>}

      {pairs.length > 0 && (
        <>
          <h3 className="section">Look like the same {meta.one}</h3>
          <ul className="assetlist">
            {pairs.map((p) => (
              <li key={`${p.from.name}→${p.into.name}`} className="tidy-pair">
                <span>
                  <strong>{p.from.name}</strong> ({p.from.count}) → <strong>{p.into.name}</strong> ({p.into.count})
                </span>
                <span className="actions">
                  <button onClick={() => setDismissed((d) => [...d, `${kind}:${p.from.name}→${p.into.name}`])}>
                    Not the same
                  </button>
                  <button className="primary" disabled={busy} onClick={() => merge(p.from.name, p.into.name)}>
                    Merge
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {used && pairs.length === 0 && (
        <p className="hint">Nothing looks doubled up.</p>
      )}

      {names.length > 1 && (
        <>
          <h3 className="section">Every {meta.one}</h3>
          <ul className="assetlist">
            {names.map((n) => (
              <li key={n.name}>
                {picking === n.name ? (
                  <div className="tidy-pick">
                    <label className="field">
                      <span>Merge "{n.name}" ({n.count}) into</span>
                      <select value={into} onChange={(e) => setInto(e.target.value)}>
                        <option value="">— pick one —</option>
                        {names.filter((m) => m.name !== n.name).map((m) => (
                          <option key={m.name} value={m.name}>{m.name} ({m.count})</option>
                        ))}
                      </select>
                    </label>
                    <div className="actions">
                      <button onClick={() => { setPicking(null); setInto('') }}>Cancel</button>
                      <button className="primary" disabled={!into || busy} onClick={() => merge(n.name, into)}>
                        Merge
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="assetrow" onClick={() => { setPicking(n.name); setInto(''); setDone(null) }}>
                    <span className="asset-name">{n.name}</span>
                    <span className="asset-meta">
                      {n.count} {n.count === 1 ? 'purchase' : 'purchases'}
                      <span className="chev">›</span>
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
