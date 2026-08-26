import { describeError, supabase } from './supabase'

export type FarmRole = 'owner' | 'manager' | 'member' | 'viewer'

export interface FarmMember {
  userId: string
  email: string
  role: FarmRole
  joinedAt: string
}

export interface CreatedInvite {
  code: string
  expiresAt: string
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

/** Owner-only. Throws with a plain "only a farm's owner can..." message otherwise. */
export async function createInvite(role: FarmRole = 'member'): Promise<CreatedInvite> {
  const { data, error } = await client().rpc('create_invite', { wanted_role: role })
  if (error) throw new Error(describeError(error))
  const row = (data as { code: string; expires_at: string }[])[0]
  return { code: row.code, expiresAt: row.expires_at }
}

/** Returns the joined farm's id. Throws if the code is invalid, expired, or already used. */
export async function redeemInvite(code: string): Promise<string> {
  const { data, error } = await client().rpc('redeem_invite', { invite_code: code })
  if (error) throw new Error(describeError(error))
  return data as string
}

/** Any member can call this — the roster itself isn't owner-only, only managing it is. */
export async function listMembers(): Promise<FarmMember[]> {
  const { data, error } = await client().rpc('list_farm_members')
  if (error) throw new Error(describeError(error))
  return (data as { user_id: string; email: string; role: FarmRole; joined_at: string }[])
    .map((r) => ({ userId: r.user_id, email: r.email, role: r.role, joinedAt: r.joined_at }))
}

/** Owner-only. Refuses to remove the owner themself — see db/schema.sql. */
export async function removeMember(userId: string): Promise<void> {
  const { error } = await client().rpc('remove_farm_member', { target: userId })
  if (error) throw new Error(describeError(error))
}

/** Owner-only. Refuses to demote the owner themself with no other owner in place. */
export async function updateMemberRole(userId: string, role: FarmRole): Promise<void> {
  const { error } = await client().rpc('update_farm_member_role', {
    target: userId, new_role: role,
  })
  if (error) throw new Error(describeError(error))
}

/**
 * Whether the signed-in user still belongs to the farm they're linked to —
 * the revocation check. `null` means the check itself couldn't be
 * completed (offline, a network error) and must never be treated as "yes,
 * revoked": only a definitive, successful query that comes back with zero
 * rows means access was actually removed. A local-only install (no
 * Supabase configured) has no farm membership concept to revoke.
 */
export async function checkStillMember(): Promise<boolean | null> {
  if (!supabase) return true
  const { data, error } = await supabase.from('farm_member').select('farm_id').limit(1)
  if (error) { console.error('checkStillMember:', describeError(error)); return null }
  return (data?.length ?? 0) > 0
}
