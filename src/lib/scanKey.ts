import { getSyncState, setSyncState } from '../db/client'
import { getFarmSetting, setFarmSetting } from '../db/queries'
import { SCAN_KEY_SETTING } from '../db/settingsSql'

/**
 * The farm's Google AI Studio key for reading receipts (lib/receiptScan.ts).
 *
 * Kept with the farm, so the owner or a manager sets it once and every
 * member's phone can scan — a farm with twenty people on it was never
 * going to have twenty people make and paste a key. It syncs like any of
 * the farm's records (see settingsSql.ts for where it lives and why).
 *
 * Every phone that scans needs the key to call Google, so anyone on the
 * farm could in principle dig it out of their own phone. For a farm's own
 * people that is fine; the only way around it would be a server that
 * holds the key and does the reading, which is a cost this app does not
 * put on anyone.
 *
 * Phones set up before this kept the key to themselves, in the unsynced
 * sync_state table. That copy is still used until the farm has one, and
 * is cleared once the farm's is saved.
 */
const LEGACY_LOCAL_KEY = 'receiptScan:geminiKey'

export async function getScanKey(): Promise<string> {
  return (await getFarmSetting(SCAN_KEY_SETTING)) ?? (await getSyncState(LEGACY_LOCAL_KEY)) ?? ''
}

/** Saves the key for the whole farm, or removes it ('' or null). */
export async function setScanKey(key: string | null): Promise<void> {
  await setFarmSetting(SCAN_KEY_SETTING, key?.trim() || null)
  await setSyncState(LEGACY_LOCAL_KEY, '')
}
