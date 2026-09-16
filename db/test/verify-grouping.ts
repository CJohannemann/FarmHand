// Renaming a flock must not spill its birds onto Inventory.
//
// Reported: "there were two in the groups, I renamed one and then got the
// random 4 that's not in the group added to the inventory."
//
// Adding a flock of fifteen writes fifteen real animal rows so each can be
// weighed, named or sold on its own later. The ones nobody has named are
// meant to stay inside the flock rather than clutter Inventory beside it,
// and whether a member counts as "never named" is read off its NAME: it
// still matches "<group> <n>".
//
// Which is fine until the group is renamed. The members keep the old
// name, the pattern stops matching, and every last one of them is
// suddenly an animal somebody named — so they all appear on Inventory as
// loose stock nobody added.
//
//   npm run verify:grouping
import {
  isUnnamedMember, memberLabel, renamedMemberName, showsOwnCard,
} from '../../src/lib/grouping.ts'
import type { Asset } from '../../src/db/types.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const asset = (over: Partial<Asset> & { name: string }): Asset => ({
  id: over.id ?? crypto.randomUUID(),
  type: 'animal',
  status: 'active',
  terminal_event: null,
  parent_id: null,
  attributes: {},
  ...over,
})

/** A flock of `n`, named the way createGroupWithMembers names them. */
const flockOf = (name: string, n: number) => {
  const group = asset({ name, type: 'group', attributes: { species: 'Chicken' } })
  const members = Array.from({ length: n }, (_, i) =>
    asset({ name: `${name} ${i + 1}`, parent_id: group.id, attributes: { species: 'Chicken' } }))
  return { group, members }
}

// ---------------------------------------------------------------------------
console.log('\nA fresh flock keeps its birds to itself')

{
  const { group, members } = flockOf('2024 Layers', 4)
  const all = [group, ...members]
  check('all four count as never-named', members.every((m) => isUnnamedMember(group, m)))
  check('so none of them gets its own row on Inventory',
    members.every((m) => !showsOwnCard(all, m)),
    `${members.filter((m) => showsOwnCard(all, m)).length} loose`)
}

// ---------------------------------------------------------------------------
console.log('\nNaming one takes it out, and only it')

{
  const { group, members } = flockOf('2024 Layers', 4)
  members[1] = { ...members[1], name: 'Henrietta' }
  const all = [group, ...members]
  check('the named one stands on its own', showsOwnCard(all, members[1]))
  check('the other three stay in the flock',
    [0, 2, 3].every((i) => !showsOwnCard(all, members[i])))
}

// ---------------------------------------------------------------------------
console.log('\nAnd renaming the flock does NOT empty it onto Inventory')

{
  const { group, members } = flockOf('2024 Layers', 4)
  // Somebody named one of them before the rename — it must come through
  // untouched. Renaming the flock is not a licence to rename Henrietta.
  members[2] = { ...members[2], name: 'Henrietta' }

  // What renameGroup() does: the group's name moves, and every member
  // still carrying the auto-name moves with it.
  const renamed: Asset = { ...group, name: 'Spring layers 26' }
  const after = members.map((m) => {
    const wanted = renamedMemberName(group.name, renamed.name, m.name)
    return wanted ? { ...m, name: wanted } : m
  })
  const all = [renamed, ...after]

  const loose = after.filter((m) => showsOwnCard(all, m) && m.name !== 'Henrietta')
  check('no bird is suddenly loose stock', loose.length === 0,
    `${loose.length} appeared: ${loose.map((m) => m.name).join(', ')}`)
  check('the three never-named ones follow the flock',
    after.filter((m) => isUnnamedMember(renamed, m)).length === 3)
  check('and are renamed after it, keeping their number',
    after[0].name === 'Spring layers 26 1' && after[3].name === 'Spring layers 26 4',
    `${after[0].name} … ${after[3].name}`)
  check('while the named one keeps the name it was given',
    after[2].name === 'Henrietta' && showsOwnCard(all, after[2]))
}

// The transformation on its own, since renameGroup leans entirely on it.
{
  check('an auto-named member is carried across',
    renamedMemberName('2024 Layers', 'Spring layers 26', '2024 Layers 7')
      === 'Spring layers 26 7')
  check('a named one is left alone',
    renamedMemberName('2024 Layers', 'Spring layers 26', 'Henrietta') === null)
  check('and so is one belonging to some other flock',
    renamedMemberName('2024 Layers', 'Spring layers 26', 'Broilers 2') === null)
}

// ---------------------------------------------------------------------------
console.log('\nThe edges around the name pattern')

{
  const { group } = flockOf('2024 Layers', 1)
  const tagged = asset({
    name: '2024 Layers 3', parent_id: group.id, attributes: { tag: 'A17' },
  })
  check('a tag stands in for an auto-name', memberLabel(group, tagged) === 'A17')
  const named = asset({ name: 'Bessie', parent_id: group.id, attributes: { tag: 'A18' } })
  check('but never for a real name', memberLabel(group, named) === 'Bessie')
}
{
  // A group name with regex punctuation in it must not blow up the pattern.
  const group = asset({ name: 'Hens (2024)', type: 'group' })
  const member = asset({ name: 'Hens (2024) 2', parent_id: group.id })
  check('a name with brackets still matches its members',
    isUnnamedMember(group, member))
  check('and does not match something else',
    !isUnnamedMember(group, asset({ name: 'Hens x2024y 2', parent_id: group.id })))
}
{
  const group = asset({ name: 'Layers', type: 'group' })
  check('a member named after a DIFFERENT group is its own animal',
    !isUnnamedMember(group, asset({ name: 'Broilers 2', parent_id: group.id })))
  check('and so is one whose name merely starts the same way',
    !isUnnamedMember(group, asset({ name: 'Layers Bessie', parent_id: group.id })))
}
{
  // An orphan — parent deleted out from under it — has to stay visible
  // rather than vanish from Inventory entirely.
  const stray = asset({ name: 'Gone Flock 2', parent_id: 'missing-group' })
  check('a member whose group is gone still shows', showsOwnCard([stray], stray))
}

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
