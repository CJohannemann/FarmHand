import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { checkScanKey, ScanError } from '../lib/receiptScan'
import { getScanKey, setScanKey } from '../lib/scanKey'
import { useCanManageFarm } from '../lib/members'

/**
 * Setting up receipt scanning for the farm: the steps to a free Google AI
 * Studio key, a box to paste it in, and a check that Google takes it before
 * it is saved — a bad key found at the moment of scanning a receipt in the
 * feed store's car park is the worst time to find it.
 *
 * The key is the farm's (lib/scanKey.ts): the owner or a manager sets it
 * once and every member can scan. Anyone else sees whether it is on, and
 * who to ask if it is not.
 *
 * Used from the Buy sheet the first time Scan is tapped, and from
 * Settings › Receipt scanning.
 */
export function ScanKeySetup({ onSaved }: { onSaved?: () => void }) {
  const { data: current, reload } = useAsync(() => getScanKey(), [])
  const canManage = useCanManageFarm()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      if (!(await checkScanKey(key))) {
        setError("Google didn't accept that key. Copy it again from AI Studio — it usually starts with \"AIza\".")
        return
      }
      await setScanKey(key)
      setKey(''); setSaved(true)
      reload()
      onSaved?.()
    } catch (e) {
      setError(e instanceof ScanError ? e.message : "Couldn't check the key. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (canManage !== true) {
    return (
      <p className="hint">
        {current
          ? 'Receipt scanning is set up for this farm — tap Scan a receipt on the Buy sheet.'
          : canManage === false
            ? 'Receipt scanning isn’t set up for this farm yet. Ask the farm’s owner or a manager to add a key under Settings › Receipt scanning.'
            : 'Receipt scanning isn’t set up yet. The farm’s owner or a manager can add a key here once this phone is online.'}
      </p>
    )
  }

  return (
    <div>
      <p className="hint">
        Scanning sends the receipt photo to Google's Gemini to read the store,
        date, total and items. It's free, using a Google key you make once.
        Saved here, it works on every phone on this farm.
      </p>
      <ol className="scan-steps">
        <li>
          Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/apikey</a> and sign in with a Google account.
        </li>
        <li>Tap <strong>Create API key</strong>, then copy it.</li>
        <li>Paste it below and tap Save.</li>
      </ol>
      <p className="hint">
        The free key has a daily limit, shared by everyone on the farm —
        plenty for one farm's receipts. On the free tier Google may use what's
        sent to improve its products, so the photo (with anything on it, like
        the last digits of a card) goes to Google. Everyone on the farm can
        use the key, so only share the farm with people you trust with it.
      </p>

      {current && !saved && <p className="notice">Scanning is on for this farm (key ending …{current.slice(-4)}).</p>}
      {saved && <p className="notice">Saved — scanning is on for everyone on this farm.</p>}

      <label className="field">
        <span>{current ? 'Replace the key' : 'Your key'}</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…"
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <div className="actions">
        {current && (
          <button type="button" disabled={busy} onClick={async () => {
            await setScanKey(null); setSaved(false); reload()
          }}>
            Turn off scanning
          </button>
        )}
        <button type="button" className="primary" disabled={busy || !key.trim()} onClick={save}>
          {busy ? 'Checking…' : 'Save'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
