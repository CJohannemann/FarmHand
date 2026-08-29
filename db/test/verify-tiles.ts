// The quick-entry tiles are the first thing anyone sees, and getting them
// wrong makes the app feel built for somebody else's farm.
//
//   npm run verify:tiles
import { purposeRequired, tilesFor, type AssetLike } from '../../src/lib/tiles.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const kinds = (assets: AssetLike[]) => tilesFor(assets).map((t) => t.kind)
const animal = (species: string, status = 'active'): AssetLike =>
  ({ type: 'animal', status, attributes: { species } })
const group = (species: string, status = 'active'): AssetLike =>
  ({ type: 'group', status, attributes: { species } })
const planting = (): AssetLike => ({ type: 'planting', attributes: { crop: 'Lettuce' } })

console.log('\nAn empty farm')
const empty = kinds([])
check('offers only what suits any farm', empty.join(',') === 'buy,note,plan', empty.join(','))
check('no eggs button with no birds', !empty.includes('eggs'))

console.log('\nCattle only')
const cattle = kinds([animal('Cattle'), animal('Cattle')])
check('no eggs', !cattle.includes('eggs'))
check('no honey', !cattle.includes('honey'))
check('no picking', !cattle.includes('pick'))
check('can feed', cattle.includes('feed'))
// Weighing moved onto the animal's own profile: it belongs to one specific
// animal, so a Today tile would only ever ask "which one?" first.
check('no weighing tile', !cattle.includes('weight'))
// Reported from a real farm: a Milk tile on a home screen with no dairy
// animal on the place. Cattle used to count as milkers whenever nobody had
// said otherwise, and nobody usually has — beef is the common case.
check('no milk tile for cattle with no purpose recorded', !cattle.includes('milk'))

console.log('\nPurpose decides whether a milker milks')
const one = (species: string, purpose: string): AssetLike =>
  ({ type: 'animal', status: 'active', attributes: { species, purpose } })
check('a dairy cow offers milk', kinds([one('Cattle', 'dairy')]).includes('milk'))
check('a beef cow does not', !kinds([one('Cattle', 'meat')]).includes('milk'))
check('a dairy goat offers milk', kinds([one('Goat', 'dairy')]).includes('milk'))
check('a meat goat does not', !kinds([one('Goat', 'meat')]).includes('milk'))
// The asymmetry is deliberate: an unrecorded bird almost certainly lays, an
// unrecorded bovine almost certainly does not milk.
check('a bird with no purpose still offers eggs',
  kinds([group('Chicken')]).includes('eggs'))
check('a meat bird does not', !kinds([one('Chicken', 'meat')]).includes('eggs'))
check('the form asks milkers and not layers',
  purposeRequired('Cattle') && purposeRequired('Goat') && purposeRequired('Sheep')
  && !purposeRequired('Chicken') && !purposeRequired('Honeybee'))

console.log('\nA laying flock')
const hens = kinds([group('Chicken')])
check('offers eggs', hens.includes('eggs'))
check('does not offer milk', !hens.includes('milk'))

console.log('\nBees only')
const bees = kinds([group('Honeybee')])
check('offers honey', bees.includes('honey'))
check('no eggs', !bees.includes('eggs'))
check('still offers notes and plans',
  bees.includes('note') && bees.includes('plan'))

console.log('\nA market garden with no animals')
const garden = kinds([planting()])
check('offers picking', garden.includes('pick'))
check('no feeding', !garden.includes('feed'))
check('no weighing', !garden.includes('weight'))

console.log('\nArchived stock does not count')
const soldUp = kinds([group('Chicken', 'archived')])
check('a finished flock stops offering eggs', !soldUp.includes('eggs'),
  soldUp.join(','))

console.log("\nChris's farm — beef cattle, pigs, layers")
// This fixture used to leave the cattle's purpose blank and expect a Milk
// tile, which is the bug a real farm reported: beef cattle, no dairy animal
// anywhere, Milk on the home screen. Marked beef now, and no milk with it.
const chris = kinds([
  one('Cattle', 'meat'), one('Cattle', 'meat'), one('Cattle', 'meat'),
  animal('Pig'), animal('Pig'),
  group('Chicken'),
  group('Chicken', 'archived'),   // the spring broilers
])
check('offers eggs', chris.includes('eggs'))
check('offers feed', chris.includes('feed'))
check('no honey', !chris.includes('honey'))
check('no picking', !chris.includes('pick'))
check('no milk on a beef farm', !chris.includes('milk'))
check('five tiles', chris.length === 5, `${chris.length}`)

console.log('\nA farm that does everything')
// The dairy purpose is what earns the milk tile — "everything" has to say so
// rather than rely on a blank meaning yes.
const everything = kinds([
  one('Cattle', 'dairy'), group('Chicken'), group('Honeybee'), planting(),
])
check('all eight, filling the grid but for one gap', everything.length === 8,
  everything.join(','))
check('no duplicates', new Set(everything).size === everything.length)

console.log('\nOrdering')
const order = kinds([animal('Cattle'), group('Chicken'), planting()])
check('daily collecting comes before chores',
  order.indexOf('eggs') < order.indexOf('feed'), order.join(','))
check('the catch-alls come last',
  order.slice(-3).join(',') === 'buy,note,plan', order.slice(-3).join(','))

// The regressions below were all found by review rather than by this file,
// which is exactly why they are pinned here now.

console.log('\nPurpose decides what a species yields')
const withPurpose = (type: string, species: string, purpose?: string): AssetLike =>
  ({ type, status: 'active', attributes: { species, ...(purpose ? { purpose } : {}) } })

check('a beef herd offers no milk',
  !kinds([withPurpose('group', 'Cattle', 'meat')]).includes('milk'))
check('a dairy herd does', kinds([withPurpose('group', 'Cattle', 'dairy')]).includes('milk'))
check('broilers offer no eggs',
  !kinds([withPurpose('group', 'Chicken', 'meat')]).includes('eggs'))
check('layers do', kinds([withPurpose('group', 'Chicken', 'eggs')]).includes('eggs'))

// Setup seeds these meat-only and offers no chips to change it, so an
// edit that strips `purpose` used to turn a turkey pen into a layer flock.
check('a meat turkey pen offers no eggs',
  !kinds([withPurpose('group', 'Turkey', 'meat')]).includes('eggs'))
check('a meat goose pen offers no eggs',
  !kinds([withPurpose('group', 'Goose', 'meat')]).includes('eggs'))

console.log('\nA custom species is not assumed to produce anything')
const custom = (category: string, purpose?: string): AssetLike =>
  ({ type: 'group', status: 'active',
     attributes: { species: 'Alpaca', category, ...(purpose ? { purpose } : {}) } })

check('a custom livestock entry with no purpose offers no milk',
  !kinds([custom('livestock')]).includes('milk'), kinds([custom('livestock')]).join(','))
check('a custom poultry entry with no purpose offers no eggs',
  !kinds([custom('poultry')]).includes('eggs'))
check('but one explicitly kept for dairy does offer milk',
  kinds([custom('livestock', 'dairy')]).includes('milk'))
check('and one explicitly kept for eggs does offer eggs',
  kinds([custom('poultry', 'eggs')]).includes('eggs'))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
