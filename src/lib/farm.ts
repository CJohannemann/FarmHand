import { describeError, supabase } from './supabase'
import { adoptFarmId, getFarmId, getFarmName } from '../db/queries'

export type FarmLink =
  | { state: 'linked'; farmId: string; name: string }
  | { state: 'created'; farmId: string; name: string }
  | { state: 'conflict'; localId: string; remoteId: string }
  | { state: 'offline' }

/**
 * Make the local farm and the remote farm agree.
 *
 * A brand new account adopts the local farm's id, so a device that already
 * has records keeps them and pushes that identity up. A second device finds
 * the farm already exists and adopts the remote id instead — safe only while
 * that device has no data of its own.
 */
export async function linkFarm(): Promise<FarmLink> {
  if (!supabase) return { state: 'offline' }

  const localId = await getFarmId()
  const localName = await getFarmName()

  const { data: memberships, error } = await supabase
    .from('farm_member')
    .select('farm_id')
    .limit(1)

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

  const remoteId = memberships[0].farm_id as string
  if (remoteId === localId) return { state: 'linked', farmId: remoteId, name: localName }

  const { data: farmRow } = await supabase
    .from('farm').select('name').eq('id', remoteId).single()

  const adopted = await adoptFarmId(remoteId, farmRow?.name ?? localName)
  return adopted
    ? { state: 'linked', farmId: remoteId, name: farmRow?.name ?? localName }
    : { state: 'conflict', localId, remoteId }
}
