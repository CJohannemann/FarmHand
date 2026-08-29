import { describeError, supabase } from './supabase'
import { adoptFarmId, getFarmId, getFarmName, purgeOrphanOutbox } from '../db/queries'
import { getSyncState, resetLocalData, setSyncState } from '../db/client'

export type FarmLink =
  // hadOwnRecords: this device already had real records under its own
  // placeholder farm when it joined — kept intact as a second local farm
  // rather than discarded, so App.tsx can say so once.
  | { state: 'linked'; farmId: string; name: string; hadOwnRecords?: boolean }
  | { state: 'created'; farmId: string; name: string }
  | { state: 'offline' }

/**
 * Make the local farm and the remote farm agree.
 *
 * A brand new account adopts the local farm's id, so a device that already
 * has records keeps them and pushes that identity up. A second device finds
 * the farm already exists and adopts the remote id instead — safe only while
 * that device has no data of its own.
 */
/**
 * Which account this device's database belongs to.
 *
 * Without it a device is nobody's, and that is not harmless: linkFarm()
 * below hands a brand-new account the local farm id through create_farm()'s
 * `wanted_id`, so signing up on a device still holding someone else's
 * records adopts them wholesale and syncs them up as the new farm's own.
 * Reported exactly that way — an account deleted, a new one signed up, and
 * the new farm arrived carrying the old one's chickens.
 *
 * It is also what stands between two people sharing a laptop and one of
 * them pushing their farm into the other's account.
 */
const OWNER_KEY = 'ownerUserId'

/**
 * Wipe this device if its records belong to a different account, and record
 * the current owner either way.
 *
 * Must run before anything reads a local farm id. A device with no owner
 * recorded is left alone — it is either brand new, or it predates this
 * check and belongs to whoever is signing in on it now.
 */
export async function claimDeviceFor(userId: string): Promise<void> {
  const owner = await getSyncState(OWNER_KEY)
  if (owner === userId) return
  if (owner !== null) await resetLocalData()
  await setSyncState(OWNER_KEY, userId)
}

export async function linkFarm(): Promise<FarmLink> {
  if (!supabase) return { state: 'offline' }

  const localId = await getFarmId()
  const localName = await getFarmName()

  // farm_member is keyed (farm_id, user_id) — one account can belong to
  // several farms, and does in practice: signing up creates an owned farm
  // (create_farm, for anyone with no membership yet), so someone who signs
  // up before redeeming their invite ends up owning a stray empty farm as
  // well as belonging to the one they were invited to.
  //
  // Which of those a bare `.limit(1)` returns is not defined — Postgres
  // promises no ordering without an `order by`, so the answer can differ
  // between two calls by the same account. That is a farm identity that
  // flips: this device adopts one farm and pulls its records, a later boot
  // picks the other, and now has two farms on its hands where it should
  // have had one. Oldest membership wins, farm_id breaking a tie, so every
  // device of every member resolves to the same farm every time.
  // No `.limit(1)` — the full list is what purgeOrphanOutbox() below needs
  // to tell a real, already-registered second farm (its queued pushes are
  // fine) from one nobody on the server has ever heard of (safe to stop
  // retrying, since they can only ever fail).
  const { data: memberships, error } = await supabase
    .from('farm_member')
    .select('farm_id')
    .order('created_at', { ascending: true })
    .order('farm_id', { ascending: true })

  // No network, or the tables are not there yet — carry on locally. Logged
  // (not surfaced to the user — this path is meant to stay quiet) since a
  // real, persistent failure here looks identical to "genuinely offline"
  // from the UI alone, and postgrest-js's `.message` alone is never enough
  // to tell the two apart — see describeError()'s own comment.
  if (error) { console.error('linkFarm: farm_member lookup failed —', describeError(error)); return { state: 'offline' } }

  if (!memberships || memberships.length === 0) {
    const { data, error: rpcError } = await supabase.rpc('create_farm', {
      farm_name: localName,
      wanted_id: localId,
    })
    if (rpcError) throw new Error(describeError(rpcError))
    return { state: 'created', farmId: data as string, name: localName }
  }

  // Runs every link, not just the first — a device already stuck retrying
  // an orphan farm's unpushable rows self-heals here too, not just one
  // linking for the first time. See purgeOrphanOutbox()'s own comment.
  await purgeOrphanOutbox(memberships.map((m) => m.farm_id as string))

  const remoteId = memberships[0].farm_id as string
  if (remoteId === localId) return { state: 'linked', farmId: remoteId, name: localName }

  const { data: farmRow } = await supabase
    .from('farm').select('name').eq('id', remoteId).single()

  const { hadOwnRecords } = await adoptFarmId(remoteId, farmRow?.name ?? localName)
  return { state: 'linked', farmId: remoteId, name: farmRow?.name ?? localName, hadOwnRecords }
}
