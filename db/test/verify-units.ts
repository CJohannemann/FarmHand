// What a unit says about the quantity beside it.
//
// No form asks whether "gal" is a volume — a farmer who picked it has
// already said so, and a dropdown asking them to confirm would be a worse
// app. So the unit is the only signal, and this table is where it gets
// read: by recordDisposition (selling, using, losing stock) and by the
// harvest form on an animal's own page.
//
// Getting one wrong does not lose stock — lotBalances counts weight, count
// and volume alike — it just records two dozen eggs as a weight of 24,
// which is wrong in every report that reads it afterwards.
//
//   npm run verify:units
import { measureForUnit } from '../../src/lib/units.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const is = (unit: string, measure: string) =>
  check(`${unit} is a ${measure}`, measureForUnit(unit) === measure, measureForUnit(unit))

console.log('\nThings you weigh')
for (const u of ['lb', 'oz', 'kg', 'g', 'ton']) is(u, 'weight')

console.log('\nThings you count')
// The eggs case is the one that prompted this: a dozen is a count of
// twelve, and "24 each" recorded as a weight was what shipped before.
for (const u of ['each', 'head', 'dozen', 'bale', 'jar']) is(u, 'count')

console.log('\nThings you pour')
for (const u of ['gal', 'qt', 'pt', 'fl oz', 'L', 'mL']) is(u, 'volume')
// A bushel is a dry volume however it is stacked.
is('bushel', 'volume')

console.log('\nEvery seeded unit is accounted for')
// Straight out of db/seed.sql, minus the ones that never label a lot's
// contents: acre and sq ft measure ground, hour measures labour, USD is a
// price. None of them reach measureForUnit.
const SEEDED = [
  'lb', 'oz', 'kg', 'g', 'ton', 'gal', 'qt', 'pt', 'fl oz', 'L', 'mL',
  'head', 'dozen', 'each', 'bale', 'bushel', 'jar',
]
for (const u of SEEDED) {
  const m = measureForUnit(u)
  check(`${u} -> ${m}`, ['weight', 'count', 'volume'].includes(m))
}
// If this fails, a unit was added to the seed list without deciding what it
// measures — it will silently be treated as a weight.
const asWeight = SEEDED.filter((u) => measureForUnit(u) === 'weight')
check('and only the weights fall through to the default',
  asWeight.join() === 'lb,oz,kg,g,ton', asWeight.join())

console.log('\nAnything unrecognised falls back rather than throwing')
check('a unit a farm typed in itself is a weight', measureForUnit('crate') === 'weight')
check('an empty unit is a weight', measureForUnit('') === 'weight')
check('so is a missing one', measureForUnit(undefined) === 'weight')
check('and a null one', measureForUnit(null) === 'weight')
check('surrounding space does not change the answer',
  measureForUnit('  each  ') === 'count')

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
