import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { receiptYears, receiptsForYear } from '../db/queries'
import { downloadZip, exportYear, fetchReceiptData } from '../lib/receipts'
import { dataUrl } from '../lib/image'

/**
 * Receipts grouped by tax year, with a per-year export.
 *
 * Lives under Analytics because that tab already answers "what happened
 * here?" and owns the header — these are the documents behind the cost
 * charts sitting immediately above them.
 *
 * Grouped by the PURCHASE's date rather than the photo's: a receipt
 * photographed in January for a December purchase belongs to December's tax
 * year, which is the only grouping an accountant can use.
 */
export function Receipts() {
  const { data: years, loading } = useAsync(() => receiptYears(), [])
  const [open, setOpen] = useState<number | null>(null)

  if (loading) return <p className="muted">Loading receipts…</p>
  if (!years?.length) {
    return (
      <p className="muted">
        No receipts yet. Photograph one when you record a purchase and it will
        be filed here by year, ready to export at tax time.
      </p>
    )
  }

  return (
    <div className="receipt-years">
      {years.map((y) => (
        <Year key={y} year={y} open={open === y} onToggle={() => setOpen(open === y ? null : y)} />
      ))}
    </div>
  )
}

function Year({ year, open, onToggle }: {
  year: number; open: boolean; onToggle: () => void
}) {
  // Only loads a year's list once it's actually opened — a farm with eight
  // years of history shouldn't query all eight to render eight headings.
  const { data, loading } = useAsync(
    () => (open ? receiptsForYear(year) : Promise.resolve(null)), [open, year],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const total = (data ?? []).reduce((n, r) => n + Number(r.amount ?? 0), 0)

  const runExport = async () => {
    setBusy('Preparing…'); setError(null); setNote(null)
    try {
      const result = await exportYear(year, ({ done, total }) =>
        setBusy(`Fetching receipt ${Math.min(done + 1, total)} of ${total}…`))
      downloadZip(result.filename, result.bytes)
      setNote(
        result.missing === 0
          ? `${result.included} receipt${result.included === 1 ? '' : 's'} exported.`
          // Never silently short: the CSV still lists these rows so the count
          // matches the books, and the gap is stated rather than discovered.
          : `${result.included} exported. ${result.missing} image${result.missing === 1 ? '' : 's'} ` +
            "couldn't be fetched — they're listed in index.csv without a file. " +
            'Try again with a connection.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="receipt-year">
      <button className="receipt-year-head" onClick={onToggle} aria-expanded={open}>
        <span className="receipt-year-label">{year}</span>
        {open && data && (
          <span className="muted">
            {data.length} receipt{data.length === 1 ? '' : 's'}
            {total > 0 && ` · $${total.toFixed(2)}`}
          </span>
        )}
        <span className="receipt-year-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          {loading && <p className="muted">Loading…</p>}

          {data && data.length > 0 && (
            <>
              <ul className="receipt-list">
                {data.map((r) => (
                  <ReceiptRow key={r.id} id={r.id} local={r.local}
                    date={r.timestamp.slice(0, 10)}
                    name={r.purchase_name}
                    supplier={r.supplier}
                    amount={r.amount} />
                ))}
              </ul>

              <button className="primary" onClick={runExport} disabled={Boolean(busy)}>
                {busy ?? `Export ${year} for taxes`}
              </button>
              <p className="hint">
                A ZIP of the images plus an index.csv listing each one against
                what it was for.
              </p>
              {note && <p className="notice">{note}</p>}
              {error && <p className="error">{error}</p>}
            </>
          )}

          {data && data.length === 0 && <p className="muted">Nothing filed under {year}.</p>}
        </>
      )}
    </section>
  )
}

function ReceiptRow({ id, local, date, name, supplier, amount }: {
  id: string; local: boolean; date: string
  name: string | null; supplier: string | null; amount: number | null
}) {
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Fetched only when asked for. The bytes are deliberately not synced in
  // bulk (see PUSH_ONLY_TABLES in lib/syncCore.ts), so tapping a receipt
  // taken on another device is what pulls it down.
  const show = async () => {
    if (image) { setImage(null); return }
    setLoading(true); setFailed(false)
    const data = await fetchReceiptData(id)
    setLoading(false)
    if (data) setImage(dataUrl('image/jpeg', data))
    else setFailed(true)
  }

  return (
    <li className="receipt-row">
      <button className="receipt-row-head" onClick={show}>
        <span className="receipt-date">{date}</span>
        <span className="receipt-what">{supplier || name || 'Purchase'}</span>
        {amount != null && <span className="receipt-amount">${Number(amount).toFixed(2)}</span>}
        {!local && <span className="receipt-remote" title="Stored on the server">☁</span>}
      </button>
      {loading && <p className="muted">Fetching…</p>}
      {failed && <p className="error">That image isn't on this device, and couldn't be fetched.</p>}
      {image && <img className="receipt-full" src={image} alt={`Receipt from ${date}`} />}
    </li>
  )
}
