// The species-bound vocabulary: sex terms and purpose labels.
//
// The point of these lists is that they are NOT interchangeable — a cow is
// never a gilt, and cattle raised for meat are beef. A table like this is
// easy to extend carelessly (paste a row, forget to change one word), so
// what is pinned here is mostly the negative case: terms from one species
// must not leak into another.
//
//   npm run verify:husbandry
import {
  GENERIC_SEX_TERMS, SEX_TERMS, purposeLabel, sexTermsFor, speciesGlyph,
} from '../../src/lib/husbandry.ts'
import { SPECIES_PURPOSES } from '../../src/lib/tiles.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

console.log('\nSex terms follow the species')
check('cattle offer Steer and Heifer',
  sexTermsFor('Cattle').includes('Steer') && sexTermsFor('Cattle').includes('Heifer'))
check('pigs offer Boar, Sow and Gilt',
  ['Boar', 'Sow', 'Gilt'].every((t) => sexTermsFor('Pig').includes(t)))
check('cattle are NOT offered Gilt', !sexTermsFor('Cattle').includes('Gilt'))
check('pigs are NOT offered Heifer', !sexTermsFor('Pig').includes('Heifer'))
check('chickens are NOT offered Steer', !sexTermsFor('Chicken').includes('Steer'))

console.log('\nEvery listed species has a usable set')
for (const [species, terms] of Object.entries(SEX_TERMS)) {
  check(`${species}: ${terms.join(', ')}`,
    terms.length >= 2 && new Set(terms).size === terms.length && terms.every(Boolean))
}

console.log('\nUnknown and missing species fall back rather than hiding the question')
check('a farm-invented species gets the plain terms',
  sexTermsFor('Water buffalo').join() === GENERIC_SEX_TERMS.join())
check('undefined falls back too', sexTermsFor(undefined).join() === GENERIC_SEX_TERMS.join())
check('null falls back too', sexTermsFor(null).join() === GENERIC_SEX_TERMS.join())

console.log('\nPurpose labels use the farm word for the species')
check('cattle for meat are Beef', purposeLabel('meat', 'Cattle') === 'Beef',
  purposeLabel('meat', 'Cattle'))
check('cattle for dairy are Dairy', purposeLabel('dairy', 'Cattle') === 'Dairy',
  purposeLabel('dairy', 'Cattle'))
check('sheep for meat are Lamb', purposeLabel('meat', 'Sheep') === 'Lamb',
  purposeLabel('meat', 'Sheep'))
check('chickens split into Layers and Broilers',
  purposeLabel('eggs', 'Chicken') === 'Layers' && purposeLabel('meat', 'Chicken') === 'Broilers')
check('goats keep the generic word', purposeLabel('meat', 'Goat') === 'Meat',
  purposeLabel('meat', 'Goat'))
check('an unknown species keeps the generic word',
  purposeLabel('meat', 'Water buffalo') === 'Meat')
check('no species at all still labels', purposeLabel('wool') === 'Wool')

console.log('\nEvery purpose a species can be asked about has a label')
for (const [species, purposes] of Object.entries(SPECIES_PURPOSES)) {
  const labels = purposes.map((p) => purposeLabel(p, species))
  check(`${species}: ${labels.join(', ')}`,
    labels.every((l) => Boolean(l) && !l.includes('undefined'))
    && new Set(labels).size === labels.length)
}

console.log('\nCards always get a glyph')
check('a known species has its own', speciesGlyph('Pig') === '🐖', speciesGlyph('Pig'))
check('an unknown species still gets one', speciesGlyph('Water buffalo') === '🐾')
check('the no-species bucket still gets one', speciesGlyph(null) === '🐾')

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
