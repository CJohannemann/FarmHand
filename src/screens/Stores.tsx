import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { lotBalances, recordDisposition, type LotBalance } from '../db/queries'
import { Sheet } from './Sheet'

const KINDS = [
  { id: 'home_use', label: 'Ate it / used at home' },
  { id: 'sold',     label: 'Sold it' },
  { id: 'given',    label: 'Gave it away' },
  { id: 'traded',   label: 'Traded it' },
  { id: 'fed_back', label: 'Fed it to livestock' },
  { id: 'lost',     label: 'Lost or spoiled' },
] as const

type Kind = typeof KINDS[number]['id']

const round = (n: number) => Math.round(n * 100) / 100

export function Stores() {
  const { data, loading, reload } = useAsync(() => lotBalances(), [])
  const [taking, setTaking] = useState<LotBalance | null>(null)

  const lots = data ?? []
  const have = lots.filter((l) => l.remaining > 0.001)
  const gone = lots.filter((l) => l.remaining <= 0.001)

  return (
    <div className="screen">
      <h1>Stores</h1>
      <p className="tagline">Feed, meat, and everything else on hand.</p>

      {loading && <p className="muted">Loading…</p>}

      {!loading && lots.length === 0 && (
        <p className="empty">
          Nothing yet. Use <strong>Buy</strong> on the Today screen, or record a
          harvest, and what you have will show up here.
        </p>
      )}

      {have.length > 0 && (
        <ul className="assetlist">
          {have.map((l) => (
            <li key={l.id}>
              <button className="assetrow" onClick={() => setTaking(l)}>
                <span className="asset-name">{l.name}</span>
                <span className="asset-meta">
                  <strong className="remaining">
                    {round(l.remaining)} {l.unit ?? ''}
                  </strong>
                  {l.material ? ` · ${l.material}` : ''}
                  <span className="chev">›</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {gone.length > 0 && (
        <>
          <h2 className="section">Used up</h2>
          <ul className="assetlist">
            {gone.map((l) => (
              <li key={l.id} className="gone">
                <button className="assetrow" onClick={() => setTaking(l)}>
                  <span className="asset-name">{l.name}</span>
                  <span className="asset-meta">
                    {round(l.came_in)} {l.unit ?? ''} in, none left
                    <span className="chev">›</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {taking && (
        <TakeForm
          lot={taking}
          onClose={() => setTaking(null)}
          onDone={() => { setTaking(null); reload() }}
        />
      )}
    </div>
  )
}

function TakeForm({
  lot, onClose, onDone,
}: { lot: LotBalance; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('home_use')
  const [amount, setAmount] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const n = Number(amount)
  const over = n > lot.remaining + 0.001

  const save = async () => {
    setBusy(true)
    await recordDisposition({
      lotId: lot.id,
      kind,
      amount: n,
      unit: lot.unit ?? 'lb',
      value: Number(value) || undefined,
    })
    setBusy(false)
    onDone()
  }

  return (
    <Sheet title={lot.name} onClose={onClose}>
      <div className="costbox">
        <div className="costrow"><span>Came in</span>
          <span>{round(lot.came_in)} {lot.unit ?? ''}</span></div>
        <div className="costrow"><span>Gone</span>
          <span>{round(lot.went_out)} {lot.unit ?? ''}</span></div>
        <div className="costrow strong"><span>Left</span>
          <span>{round(lot.remaining)} {lot.unit ?? ''}</span></div>
      </div>

      <label className="field" style={{ marginTop: '1.25rem' }}>
        <span>What happened to it?</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>How much ({lot.unit ?? 'lb'})</span>
        <input type="number" inputMode="decimal" autoFocus value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="20" />
        {over && (
          <small className="hint warn">
            That is more than the {round(lot.remaining)} {lot.unit ?? ''} left.
            Saving anyway is fine — records are often behind reality.
          </small>
        )}
      </label>

      <label className="field">
        <span>
          {kind === 'sold' ? 'What you got paid ($)' : 'What it would have cost to buy ($)'}
        </span>
        <input type="number" inputMode="decimal" value={value}
          onChange={(e) => setValue(e.target.value)} placeholder="89.80" />
        {kind === 'home_use' && (
          <small className="hint">
            Optional. Putting the shop price here is what lets the app tell you
            whether raising it beat buying it.
          </small>
        )}
      </label>

      <button className="primary" disabled={busy || !(n > 0)} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}
