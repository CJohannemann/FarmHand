import type { Asset } from '../db/types'

/**
 * Which members of a herd or flock are the farm's own animals, and which
 * are just headcount.
 *
 * Adding a group of fifteen writes fifteen real animal rows, so that each
 * one can be weighed, named or sold on its own later. Listing all fifteen
 * on Inventory beside the flock they belong to would say nothing a
 * headcount doesn't — so the ones nobody has named stay inside the group,
 * and the ones somebody has named come out and stand on their own.
 *
 * Lives here rather than in a screen so the rule can be tested directly.
 * It got this file when renaming a flock turned out to spill its members
 * onto Inventory; see isUnnamedMember.
 */

/** Group names are user text and land inside a RegExp — escape them. */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a member still carries the "<group> <n>" name it was created
 * with — i.e. whether nobody has ever named it.
 *
 * Reading that off the name is the fragile part, and it broke exactly as
 * you would expect: renaming a flock left its members called after the
 * OLD name, the pattern stopped matching, and all fifteen "unnamed"
 * animals appeared on Inventory as loose stock nobody had added. Reported
 * as "I renamed one and got a random 4 added to my inventory".
 *
 * The name is still what identifies them, but renaming a group now renames
 * its auto-named members with it (see renameGroup in db/queries.ts), so
 * the pattern and the name never drift apart in the first place.
 */
export function isUnnamedMember(group: Asset, member: Asset): boolean {
  return autoMemberNumber(group.name, member.name) !== null
}

/**
 * The member's number if it still carries its group's auto-name — "2024
 * Layers 3" under "2024 Layers" gives "3" — and null once somebody has
 * named it something of its own.
 */
export function autoMemberNumber(groupName: string, memberName: string): string | null {
  const m = new RegExp(`^${escapeRe(groupName)} (\\d+)$`).exec(memberName)
  return m ? m[1] : null
}

/**
 * What an auto-named member should be called once its group is renamed, or
 * null for a member that should be left alone.
 *
 * This is the whole fix for the spill. Membership is read off the name, so
 * the names have to move together — rename the flock and "2024 Layers 3"
 * becomes "Spring layers 26 3", still recognisably the flock's third bird
 * and still tucked inside it. A member somebody actually named keeps that
 * name: renaming the flock is not a licence to rename Henrietta.
 */
export function renamedMemberName(
  oldGroupName: string, newGroupName: string, memberName: string,
): string | null {
  const n = autoMemberNumber(oldGroupName, memberName)
  return n === null ? null : `${newGroupName} ${n}`
}

/**
 * Whether this animal earns its own row on Inventory.
 *
 * Anything standalone does. A member does only once it has a name of its
 * own — otherwise it is reached through its group.
 */
export function showsOwnCard(assets: Asset[], a: Asset): boolean {
  if (!a.parent_id) return true
  const group = assets.find((g) => g.id === a.parent_id)
  return !group || !isUnnamedMember(group, a)
}

/**
 * What to call a member in its group's own Members list.
 *
 * "Cattle (beef) 3" tells a commercial operator nothing a tag number
 * wouldn't, and clutters a list that is otherwise all real names. Only
 * stands in for an auto-generated name that was never replaced; a member
 * someone actually named keeps that name, since that is the point of
 * naming it.
 */
export function memberLabel(group: Asset, member: Asset): string {
  const tag = member.attributes?.tag
  if (tag && isUnnamedMember(group, member)) return String(tag)
  return member.name
}
