import { markWipePending } from '../db/cutover'
import { supabase } from './supabase'

const REVOKED_KEY = 'farmhand.revoked'

/**
 * Called the moment a sync poll confirms this account no longer belongs to
 * its farm (see checkStillMember() in lib/members.ts, hooked into
 * lib/useSync.ts's polling loop). Signs the device out immediately, so no
 * further sync can happen with the now-invalid membership, and marks local
 * data for deletion on the next boot.
 */
export async function handleRevokedAccess(): Promise<void> {
  markWipePending()
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
