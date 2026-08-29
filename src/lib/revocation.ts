import { resetLocalData } from '../db/client'
import { supabase } from './supabase'

const REVOKED_KEY = 'farmhand.revoked'

/**
 * Called the moment a sync poll confirms this account no longer belongs to
 * its farm (see checkStillMember() in lib/members.ts, hooked into
 * lib/useSync.ts's polling loop). Signs the device out immediately, so no
 * further sync can happen with the now-invalid membership, and clears the
 * local copy of the farm they have been removed from.
 */
export async function handleRevokedAccess(): Promise<void> {
  // Wiped here rather than flagged for the next boot. Flagging deleted the
  // whole IndexedDB database on reload, which blocks while any other tab has
  // the app open and reported success on a timeout regardless — so a second
  // open tab was enough to leave a removed member holding a full copy of a
  // farm they no longer belong to.
  await resetLocalData()
  localStorage.setItem(REVOKED_KEY, '1')
  await supabase?.auth.signOut()
}

/**
 * Read once, when the sign-in screen mounts. True only the one time it's
 * showing because this device was just removed from its farm, not for an
 * ordinary sign-out — reading it clears it, same one-shot pattern as
 * lib/inviteLink.ts's URL read.
 */
export function consumeRevokedFlag(): boolean {
  const was = localStorage.getItem(REVOKED_KEY) === '1'
  if (was) localStorage.removeItem(REVOKED_KEY)
  return was
}
