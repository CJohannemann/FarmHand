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
  GENERIC_SEX_TERMS, GESTATION, SEX_TERMS, daysUntil, dueDate, dueLabel, gestationFor,
  gestationSentence, pluralSpecies, purposeLabel, sexTermsFor, speciesGlyph,
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

// Due dates. The arithmetic is the whole feature: a farmer records the day
// a sow went to the boar and wants the day to bed the farrowing pen, not a
// number of days to count on a calendar. Every date below was worked out by
// hand against a calendar, not by running the function being tested.
console.log('\nDue dates come off the breeding date')
const dayOf = (d: Date | null) => (d ? d.toDateString() : 'null')
check('a sow bred Jan 1 2026 farrows Apr 25 — 3 months, 3 weeks and 3 days',
  dayOf(dueDate(new Date(2026, 0, 1, 12), 'Pig')) === 'Sat Apr 25 2026',
  dayOf(dueDate(new Date(2026, 0, 1, 12), 'Pig')))
check('a cow bred Mar 10 2026 calves Dec 18',
  dayOf(dueDate(new Date(2026, 2, 10, 12), 'Cattle')) === 'Fri Dec 18 2026',
  dayOf(dueDate(new Date(2026, 2, 10, 12), 'Cattle')))
check('a ewe bred Sep 9 2026 lambs Feb 3 2027',
  dayOf(dueDate(new Date(2026, 8, 9, 12), 'Sheep')) === 'Wed Feb 03 2027',
  dayOf(dueDate(new Date(2026, 8, 9, 12), 'Sheep')))
check('eggs set Sep 9 2026 hatch Sep 30',
  dayOf(dueDate(new Date(2026, 8, 9, 12), 'Chicken')) === 'Wed Sep 30 2026',
  dayOf(dueDate(new Date(2026, 8, 9, 12), 'Chicken')))

// The reason dueDate() builds its result at noon rather than adding
// milliseconds: a gestation that steps over a daylight-saving boundary
// would otherwise land on the evening before and read as a day early.
console.log('\nA daylight-saving boundary inside the term does not shift the date')
check('a sow bred Feb 1 2026 still farrows on the 26th of May',
  dayOf(dueDate(new Date(2026, 1, 1, 12), 'Pig')) === 'Tue May 26 2026',
  dayOf(dueDate(new Date(2026, 1, 1, 12), 'Pig')))
for (const [species, term] of Object.entries(GESTATION)) {
  const due = dueDate(new Date(2026, 0, 15, 0, 30), species)
  check(`${species} (${term.days}d) lands mid-day, whatever hour it was bred at`,
    due !== null && due.getHours() === 12)
}

console.log('\nA species with no known term gets no invented one')
check('a farm-invented species has no gestation', gestationFor('Water buffalo') === null)
check('and so gets no due date', dueDate(new Date(), 'Water buffalo') === null)
check('nor does an unset species', dueDate(new Date(), '') === null)
check('an unparseable date is refused rather than guessed',
  dueDate('not a date', 'Pig') === null)

console.log('\nThe countdown reads as a farmer would say it')
const jan = (day: number) => new Date(2026, 0, day, 12)
check('today', dueLabel(daysUntil(jan(10), jan(10))) === 'today')
check('tomorrow', dueLabel(daysUntil(jan(11), jan(10))) === 'tomorrow')
check('in 12 days', dueLabel(daysUntil(jan(22), jan(10))) === 'in 12 days')
check('one day past is overdue, not "yesterday"',
  dueLabel(daysUntil(jan(9), jan(10))) === '1 day overdue',
  dueLabel(daysUntil(jan(9), jan(10))))
check('and so is a week past',
  dueLabel(daysUntil(jan(3), jan(10))) === '7 days overdue',
  dueLabel(daysUntil(jan(3), jan(10))))
// The hour of day must not round a whole day off the count — read at
// 11pm the night before, "tomorrow" is still tomorrow.
check('the count is in calendar days, not 24-hour blocks',
  daysUntil(new Date(2026, 0, 11, 1), new Date(2026, 0, 10, 23)) === 1)

console.log('\nEvery term says where it came from, in the right words')
for (const [species, term] of Object.entries(GESTATION)) {
  const sentence = gestationSentence(species) ?? ''
  check(`${species}: ${sentence} (due to ${term.verb})`,
    sentence.includes(term.phrase)
    && sentence.includes(term.kind === 'incubation' ? 'hatch' : 'carry')
    && Boolean(term.verb))
}
check('a species with no term has no sentence to offer',
  gestationSentence('Water buffalo') === null)
// Birds sit on eggs; they are not pregnant. Getting this backwards is the
// one thing this table could say that a farmer would find insulting.
check('birds incubate, mammals gestate',
  GESTATION.Chicken.kind === 'incubation' && GESTATION.Cattle.kind === 'gestation')
check('a hen is not "due to calve"',
  GESTATION.Chicken.verb === 'hatch' && GESTATION.Cattle.verb === 'calve')

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
