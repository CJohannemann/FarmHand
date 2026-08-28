import { useRef, useState } from 'react'

/**
 * One save, however many times the button is pressed.
 *
 * Writing a record goes through several awaits — the log, its asset links,
 * its quantities, each a round trip to the database in a worker. On a phone
 * that is long enough to feel like nothing happened, so the natural response
 * is to press Save again. Without a guard each press runs the whole save,
 * and the farm quietly ends up with the same harvest recorded three times.
 * Found exactly that way: three identical "got meat" rows from one close-out.
 *
 * The ref is the part that actually fixes it, not the `busy` state. State
 * updates are asynchronous and batched, so two presses in the same tick both
 * read `busy === false` and both proceed. A ref updates synchronously, which
 * is what makes the second press a no-op rather than a second record.
 * `busy` exists only to drive the button — it can't be trusted to gate.
 *
 * Errors are caught and returned rather than thrown into an unhandled
 * rejection: a save that fails silently looks identical to one that worked,
 * which is how someone walks away believing a record exists.
 */
export function useSave(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const run = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message || 'Saving failed.')
    } finally {
      inFlight.current = false
      // A successful save usually closes the sheet, unmounting this — React
      // no longer warns about setting state on an unmounted component, and
      // the alternative (an isMounted ref) is the pattern React's own docs
      // moved away from.
      setBusy(false)
    }
  }

  return { run, busy, error }
}
