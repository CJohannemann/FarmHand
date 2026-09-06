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
  GENERIC_SEX_TERMS, SEX_TERMS, pluralSpecies, purposeLabel, sexTermsFor, speciesGlyph,
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

// Naming a whole species at once — "All Cattle (5)" on the Feeding sheet,
// and the section headings in its feed picker. Adding an "s" to everything
// is what these lists exist to stop: "Cattles" and "Sheeps" read as bugs.
console.log('\nSpecies plurals are the words a farm would use')
check('Pig pluralises normally', pluralSpecies('Pig') === 'Pigs', pluralSpecies('Pig'))
check('Cattle is already plural', pluralSpecies('Cattle') === 'Cattle', pluralSpecies('Cattle'))
check('so is Sheep', pluralSpecies('Sheep') === 'Sheep', pluralSpecies('Sheep'))
check('Goose is irregular', pluralSpecies('Goose') === 'Geese', pluralSpecies('Goose'))
check('Quail takes the unmarked plural', pluralSpecies('Quail') === 'Quail',
  pluralSpecies('Quail'))
check('Honeybee pluralises normally', pluralSpecies('Honeybee') === 'Honeybees',
  pluralSpecies('Honeybee'))
check('a farm-invented species still gets a plural',
  pluralSpecies('Water buffalo') === 'Water buffalos', pluralSpecies('Water buffalo'))
check('and one already ending in s is left alone',
  pluralSpecies('Alpacas') === 'Alpacas', pluralSpecies('Alpacas'))

console.log('\nEvery seeded species has a plural that is not just +s guesswork')
for (const species of Object.keys(SEX_TERMS)) {
  const p = pluralSpecies(species)
  check(`${species} → ${p}`, Boolean(p) && !p.endsWith('ss'))
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
