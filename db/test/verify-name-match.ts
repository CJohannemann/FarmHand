// When two names are the same thing written differently.
//
// Two people on one farm: "Hog feed" from one, "Pig feed" from the other;
// "Lowes" from one, "Lowe's" from the other. Each spelling is its own bag
// in Stores and its own row in a project's By store. The app offers the
// name already in use before a new spelling is saved, and Settings finds
// the pairs that slipped through. Both rest on these rules — and the ones
// worth guarding hardest are the names that must NOT be called the same.
//
//   npm run verify:name-match
import {
  canonical, didYouMean, likelyDuplicates, notSameKey, similarNames, suggestNames,
} from '../../src/lib/nameMatch.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const same = (a: string, b: string) => check(`"${a}" ≈ "${b}"`, similarNames(a, b) && similarNames(b, a))
const differ = (a: string, b: string) => check(`"${a}" ≠ "${b}"`, !similarNames(a, b) && !similarNames(b, a))

console.log('\nThe same thing, written differently')
same('Hog feed', 'Pig feed')
same('hog feed', 'Pig Feed')
same('Swine feed', 'Pig feed')
same('Layer feed', 'Chicken feed')
same('Cow hay', 'Cattle hay')
same('Lowes', "Lowe's")
same("Lowe's", "Lowe's Home Improvement")
same('TSC', 'Tractor Supply Co')
same('Tractor Supply', 'Tractor Supply Co.')
same('Wiseway', 'Wise way')
same('Wiseway', 'Wisway')
same('Co-op', 'Coop')
same('Café', 'Cafe')

console.log('\nDifferent things that only look close')
differ('Pig feed', 'Chicken feed')
differ('Pig feed', 'Goat feed')
differ('Hay', 'Straw')
differ('Feed', 'Seed')
differ('Lowes', 'Home Depot')
differ('TSC', 'TCS Feeds')
differ('Cattle hay', 'Cattle mineral')
differ('', 'Pig feed')

console.log('\nCanonical form')
check('plural and possessive fold the same', canonical("Lowe's") === canonical('Lowes'), canonical("Lowe's"))
check('grass keeps its double s', canonical('Grass seed') === 'grass seed', canonical('Grass seed'))

console.log('\nOffering the name already in use')
const stores = [
  { name: "Lowe's", count: 9 }, { name: 'Wiseway', count: 4 },
  { name: 'Tractor Supply Co', count: 6 }, { name: 'A&S Electric', count: 1 },
]
check('nothing typed offers the usual stores, most used first',
  suggestNames('', stores).map((s) => s.name).join() === "Lowe's,Tractor Supply Co,Wiseway,A&S Electric")
check('"low" offers Lowe\'s', suggestNames('low', stores)[0]?.name === "Lowe's")
check('"tsc" offers Tractor Supply', suggestNames('tsc', stores)[0]?.name === 'Tractor Supply Co',
  suggestNames('tsc', stores).map((s) => s.name).join())
check('an exact name already in use needs no suggestion', suggestNames('Wiseway', stores).length === 0)
check('nor does it in other capitals', suggestNames('wiseway', stores).length === 0)

console.log('\nThe list narrows as you type, capitals ignored')
const many = ['TSC', 'Tractor Supply', 'Seiters', 'Wiseway', "Lowe's", 'Rural King', 'Tri-County Feed',
  'Home Depot', 'The Co-op'].map((name, i) => ({ name, count: 20 - i }))
const names = (input: string) => suggestNames(input, many).map((s) => s.name).join(', ')
check('"t" — only what starts with T, most used first', names('t') === 'TSC, Tractor Supply, Tri-County Feed, The Co-op', names('t'))
check('"T" is the same as "t"', names('T') === names('t'))
check('"tr" narrows further', names('tr') === 'Tractor Supply, Tri-County Feed', names('tr'))
check('"TRA" is the same as "tra"', names('TRA') === 'Tractor Supply' && names('tra') === 'Tractor Supply', names('TRA'))
check('a later word counts too, after the names that start with it',
  names('s') === 'Seiters, Tractor Supply', names('s'))
check('"co" finds The Co-op by its own word', names('co').includes('The Co-op'), names('co'))
check('nothing typed: every store, most used first', names('').startsWith('TSC, Tractor Supply, Seiters'))
check('a letter nothing starts with offers nothing', names('q') === '', names('q'))
check('"Lowes" — did you mean Lowe\'s?', didYouMean('Lowes', stores) === "Lowe's")
check('the exact name is not second-guessed', didYouMean("Lowe's", stores) === null)
check('a genuinely new store is left alone', didYouMean('Rural King', stores) === null)
const feeds = [{ name: 'Pig feed', count: 5 }, { name: 'Chicken feed', count: 3 }]
check('"Hog feed" — did you mean Pig feed?', didYouMean('Hog feed', feeds) === 'Pig feed')

console.log('\nFinding duplicates already saved')
const dups = likelyDuplicates([
  { name: 'Pig feed', count: 5 }, { name: 'Hog feed', count: 2 },
  { name: 'Chicken feed', count: 3 }, { name: 'Lowes', count: 1 }, { name: "Lowe's", count: 7 },
])
const pairs = dups.map((d) => `${d.from.name}→${d.into.name}`).sort()
check('finds both pairs, merging the less used into the more used',
  pairs.join(' | ') === "Hog feed→Pig feed | Lowes→Lowe's", pairs.join(' | '))
check('and leaves chicken feed out of it', !pairs.some((p) => p.includes('Chicken')))

console.log('\n"Not the same" stays answered')
check('either way round is the same answer',
  notSameKey('item', 'Pig feeder', 'Pig feed') === notSameKey('item', 'Pig feed', 'Pig feeder'))
check('capitals and stray spaces do not matter',
  notSameKey('item', ' pig FEEDER', 'Pig feed') === notSameKey('item', 'Pig feeder', 'Pig feed'))
check('an item answer is not a store answer',
  notSameKey('item', 'Lowes', "Lowe's") !== notSameKey('store', 'Lowes', "Lowe's"))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
