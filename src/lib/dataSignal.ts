/**
 * A signal that sync just pulled something new, so every screen watching
 * local data knows to re-read it.
 *
 * Without this, a screen that mounted before the first sync round-trip
 * finished (opening the app, or just after accepting a farm invite, when
 * the device starts out with nothing local at all) keeps showing whatever
 * it read on that first, still-empty query forever — until something else
 * happens to remount it or the person manually refreshes. useAsync
 * subscribes to this so every query it backs re-runs the moment new rows
 * actually land, not just on its own mount or an explicit reload().
 */

const listeners = new Set<() => void>()

/** Returns its own unsubscribe. */
export function onDataChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function noteDataChanged(): void {
  for (const listener of listeners) listener()
}
