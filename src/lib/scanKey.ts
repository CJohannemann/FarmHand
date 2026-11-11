import { getSyncState, setSyncState } from '../db/client'

/**
 * The farm's Google AI Studio key for reading receipts (lib/receiptScan.ts).
 *
 * Kept on this phone, in the local database's sync_state table — which is
 * never synced — and not on the farm's records, which are. A key is a
 * password to someone's Google account; it has no business sitting in a
 * shared database where every member, viewers included, could read it.
 * The cost is that each phone pastes it once.
 */
const KEY = 'receiptScan:geminiKey'

export async function getScanKey(): Promise<string> {
  return (await getSyncState(KEY)) ?? ''
}

export async function setScanKey(key: string): Promise<void> {
  await setSyncState(KEY, key.trim())
}
