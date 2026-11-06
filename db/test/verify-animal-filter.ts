// Records' animal filter: what counts as a record about one animal.
//
// The rule worth pinning is the group one. A pen of four is often fed as
// one ("Fed Pigs"), and that feeding is every pig's feeding — so picking
// one pig has to include it, or its history quietly loses most of its feed.
//
//   npm run verify:animal-filter
import {
  idsForAnimalFilter, logMatchesAnimal, SPECIES_FILTER, type FilterAnimal,
} from '../../src/lib/animalFilter.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const a = (id: string, type: string, species: string, parent: string | null = null): FilterAnimal =>
  ({ id, type, parent_id: parent, attributes: { species } })
const farm = [
  a('pen', 'group', 'Pig'),
  a('rita', 'animal', 'Pig', 'pen'), a('runt', 'animal', 'Pig', 'pen'),
  a('bacon', 'animal', 'Pig'),
  a('bessie', 'animal', 'Cattle'),
]
const about = (picked: string, subjects: string) =>
  logMatchesAnimal(subjects, idsForAnimalFilter(picked, farm))

console.log('\nNo filter')
check('everything shows', about('', 'bessie') && logMatchesAnimal(null, idsForAnimalFilter('', farm)))

console.log('\nOne animal')
check('its own feeding', about('rita', 'rita'))
check('a feeding of it alongside another', about('rita', 'rita,runt'))
check('its pen fed as one', about('rita', 'pen'))
check('not its penmate\'s own weigh-in', !about('rita', 'runt'))
check('not another species', !about('rita', 'bessie'))
check('a record with no animals at all is not about it', !about('rita', ''))

console.log('\nA group')
check('fed as one', about('pen', 'pen'))
check('and what was logged against one member', about('pen', 'runt'))
check('but not a pig outside it', !about('pen', 'bacon'))

console.log('\nA whole species')
check('a lone pig', about(SPECIES_FILTER + 'Pig', 'bacon'))
check('a pen of pigs', about(SPECIES_FILTER + 'Pig', 'pen'))
check('not the cow', !about(SPECIES_FILTER + 'Pig', 'bessie'))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
