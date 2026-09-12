import { useState } from 'react'
import { useSave } from '../lib/useSave'
import { cancelTask, completeTask, planTask, updateLog } from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { AssetSelect } from './AssetSelect'
import { Sheet } from './Sheet'
import { dueText } from './TaskList'

/** A date input wants `yyyy-mm-dd` in local time, which toISOString isn't. */
function forInput(when: Date | string): string {
  const d = new Date(when)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * One sheet for a farm chore, whether it is being written down for the
 * first time or opened again a week later.
 *
 * Both are the same handful of facts — what needs doing, when, what it's
 * for, and whatever detail won't fit in the one-line name ("gate latch on
 * the north fence, bring the cordless drill"). Two separate forms would
 * have meant maintaining the same four fields twice and, worse, a chore
 * that could be written but never corrected.
 *
 * A chore is a planned log like any other, so ticking it off writes the
 * farm's history rather than deleting a to-do — see planTask/completeTask.
 * What can't be edited here is which asset it's for: the link lives in
 * log_asset rather than on the log row, and re-pointing it is rare enough
 * that showing the answer read-only beats a half-working picker.
 */
export function ChoreSheet({
  chore, initialDate, onDone, onClose,
}: {
  /** Omitted for a brand-new chore. */
  chore?: LogWithDetail
  /**
   * What day a NEW chore starts on — the day tapped on the Calendar.
   * Ignored when editing, which takes its date from the chore
   * itself. Without it, planning next month's worming from the calendar
   * would open on today and make every chore start with a correction.
   */
  initialDate?: Date
  onDone: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(chore?.name ?? '')
  const [when, setWhen] = useState(() => forInput(chore?.timestamp ?? initialDate ?? new Date()))
  const [asset, setAsset] = useState('')
  const [notes, setNotes] = useState(chore?.notes ?? '')
  const [dropping, setDropping] = useState(false)

  const save = async () => {
    if (chore) {
      await updateLog(chore.id, {
        name: name.trim(),
        notes: notes.trim() || null,
        timestamp: new Date(`${when}T09:00:00`),
      })
    } else {
      await planTask({
        name: name.trim(),
        due: new Date(`${when}T09:00:00`),
        notes: notes.trim() || undefined,
        assetId: asset || undefined,
      })
    }
    onDone()
  }
  const { run, busy, error } = useSave(save)

  const finish = useSave(async () => { await completeTask(chore!.id); onDone() })
  const drop = useSave(async () => { await cancelTask(chore!.id); onDone() })

  const d = chore ? dueText(chore.timestamp) : null

  return (
    <Sheet title={chore ? (chore.name ?? 'Chore') : 'Add a chore'} onClose={onClose}>
      {!chore && (
        <p className="hint">
          Chores live in the same records as everything else, so ticking one
          off writes the history for you.
        </p>
      )}
      <label className="field">
        <span>What needs doing?</span>
        <input autoFocus={!chore} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Worm the cattle" />
      </label>
      <label className="field">
        <span>When</span>
        <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        {d && <small className={d.late ? 'hint warn' : 'hint'}>Due {d.text}.</small>}
      </label>
      {chore ? (
        chore.subjects && (
          <div className="field">
            <span>What for</span>
            <div className="costbox">
              <div className="costrow"><span>{chore.subjects}</span></div>
            </div>
          </div>
        )
      ) : (
        <AssetSelect value={asset} onChange={setAsset} label="What for? (optional)" />
      )}
      <label className="field">
        <span>Details (optional)</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Gate latch on the north fence — bring the cordless drill" />
      </label>

      {chore ? (
        <>
          <button className="primary" disabled={finish.busy} onClick={finish.run}>
            {finish.busy ? 'Saving…' : 'Mark it done'}
          </button>
          <div className="actions">
            <button disabled={busy || !name.trim()} onClick={run}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          {(error || finish.error || drop.error) && (
            <p className="error">{error ?? finish.error ?? drop.error}</p>
          )}
          {!dropping ? (
            <button className="danger" onClick={() => setDropping(true)}>
              Drop this chore
            </button>
          ) : (
            <div className="confirm">
              <p>
                Drop {chore.name ?? 'this chore'}? It comes off the list without
                being recorded as done — if it did get done, tick it instead.
              </p>
              <div className="actions">
                <button onClick={() => setDropping(false)}>Keep it</button>
                <button className="danger" disabled={drop.busy} onClick={drop.run}>Drop it</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <button className="primary" disabled={busy || !name.trim()} onClick={run}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </Sheet>
  )
}
