import type { Purpose } from './tiles'

/**
 * The words a farm actually uses for its animals.
 *
 * "Male/Female" is technically correct and useless in a barn: a steer and a
 * bull are both male cattle and are not remotely the same animal, and the
 * distinction (intact, castrated, has it calved yet) is exactly what a
 * stockman records. These terms are also strictly species-bound — a cow is
 * never a gilt — so the list has to follow whatever species is picked
 * rather than offering one flat set.
 *
 * Ordered male-then-female-then-young within each species, which is the
 * order these are usually rattled off, and keeps the intact/castrated pair
 * adjacent where one exists.
 */
export const SEX_TERMS: Record<string, string[]> = {
  Cattle:  ['Bull', 'Steer', 'Cow', 'Heifer', 'Calf'],
  Pig:     ['Boar', 'Barrow', 'Sow', 'Gilt', 'Piglet'],
  Sheep:   ['Ram', 'Wether', 'Ewe', 'Lamb'],
  Goat:    ['Buck', 'Wether', 'Doe', 'Doeling', 'Kid'],
  Horse:   ['Stallion', 'Gelding', 'Mare', 'Filly', 'Colt', 'Foal'],
  Rabbit:  ['Buck', 'Doe', 'Kit'],
  Chicken: ['Rooster', 'Cockerel', 'Hen', 'Pullet', 'Chick'],
  Duck:    ['Drake', 'Duck', 'Duckling'],
  Goose:   ['Gander', 'Goose', 'Gosling'],
  Turkey:  ['Tom', 'Hen', 'Poult'],
  Quail:   ['Cock', 'Hen', 'Chick'],
}

/**
 * Anything not on the list — including a species the farm typed in itself —
 * still gets asked, just in plain terms. Better than hiding the question.
 */
export const GENERIC_SEX_TERMS = ['Female', 'Male']

export function sexTermsFor(species: string | undefined | null): string[] {
  return SEX_TERMS[String(species ?? '')] ?? GENERIC_SEX_TERMS
}

/**
 * Species whose plural isn't the singular plus an "s".
 *
 * Two of the seeded species are already plural ("five Cattles" reads as a
 * typo, because it is one), and Goose is irregular outright. Quail takes
 * the unmarked plural the way farms actually say it — "we run 200 quail".
 */
const PLURAL_SPECIES: Record<string, string> = {
  Cattle: 'Cattle', Sheep: 'Sheep', Goose: 'Geese', Quail: 'Quail',
  Bison: 'Bison', Elk: 'Elk', Deer: 'Deer', Fish: 'Fish', Swine: 'Swine',
}

/**
 * "Pigs", "Geese", "Cattle" — for a heading or a count that names a whole
 * species at once. A farm-invented species falls back to plus-"s", which is
 * right often enough and never mangles what was typed beyond recognition.
 */
export function pluralSpecies(species: string): string {
  const known = PLURAL_SPECIES[species]
  if (known) return known
  return species.endsWith('s') ? species : `${species}s`
}

/**
 * Only the terms breeding actually cares about — a steer or a wether is
 * just as male as a bull or a ram, but neither can sire anything, so
 * "male" alone is the wrong question for a Sire picker. Juvenile terms
 * (Calf, Piglet, Foal...) and anything not listed here are left
 * unclassified on purpose: an unset or not-yet-obvious sex shouldn't
 * quietly disappear from both pickers just because nobody's settled it
 * yet, the way a definite wrong sex should.
 */
const SEX_ROLE: Record<string, Record<string, 'sire' | 'dam' | 'neither'>> = {
  Cattle:  { Bull: 'sire', Steer: 'neither', Cow: 'dam', Heifer: 'dam' },
  Pig:     { Boar: 'sire', Barrow: 'neither', Sow: 'dam', Gilt: 'dam' },
  Sheep:   { Ram: 'sire', Wether: 'neither', Ewe: 'dam' },
  Goat:    { Buck: 'sire', Wether: 'neither', Doe: 'dam', Doeling: 'dam' },
  Horse:   { Stallion: 'sire', Gelding: 'neither', Mare: 'dam', Filly: 'dam', Colt: 'sire' },
  Rabbit:  { Buck: 'sire', Doe: 'dam' },
  Chicken: { Rooster: 'sire', Cockerel: 'sire', Hen: 'dam', Pullet: 'dam' },
  Duck:    { Drake: 'sire', Duck: 'dam' },
  Goose:   { Gander: 'sire', Goose: 'dam' },
  Turkey:  { Tom: 'sire', Hen: 'dam' },
  Quail:   { Cock: 'sire', Hen: 'dam' },
}

/** Whether a sex term (for a given species) could be a sire, a dam, or neither — unknown if unclassified. */
export function sexRole(
  species: string | undefined | null, sex: string | undefined | null,
): 'sire' | 'dam' | 'neither' | 'unknown' {
  if (!sex) return 'unknown'
  const bySpecies = SEX_ROLE[String(species ?? '')]?.[sex]
  if (bySpecies) return bySpecies
  // A species outside SEX_TERMS falls back to the plain "Female"/"Male"
  // chips (GENERIC_SEX_TERMS) — those are the terms to recognize here too.
  if (sex === 'Female') return 'dam'
  if (sex === 'Male') return 'sire'
  return 'unknown'
}

/**
 * What a purpose is called for a given species. Cattle raised for meat are
 * beef, not "meat"; sheep are lamb; birds kept for eggs are layers. The
 * generic word is only right when nothing more specific exists, or when the
 * species is unknown (a custom entry someone typed under a category).
 */
const PURPOSE_BY_SPECIES: Record<string, Partial<Record<Purpose, string>>> = {
  Cattle:  { meat: 'Beef' },
  Sheep:   { meat: 'Lamb' },
  Chicken: { eggs: 'Layers', meat: 'Broilers' },
}

const GENERIC_PURPOSE: Record<Purpose, string> = {
  eggs: 'Eggs', meat: 'Meat', dairy: 'Dairy', wool: 'Wool',
}

export function purposeLabel(purpose: Purpose, species?: string | null): string {
  return PURPOSE_BY_SPECIES[String(species ?? '')]?.[purpose] ?? GENERIC_PURPOSE[purpose]
}

/** For the species cards on the Stock screen. */
const SPECIES_GLYPH: Record<string, string> = {
  Cattle: '🐄', Pig: '🐖', Sheep: '🐑', Goat: '🐐', Horse: '🐴', Rabbit: '🐇',
  Chicken: '🐔', Duck: '🦆', Goose: '🦢', Turkey: '🦃', Quail: '🐦',
  Honeybee: '🐝', Alpaca: '🦙', Llama: '🦙', Donkey: '🫏',
}

export function speciesGlyph(species: string | null): string {
  return SPECIES_GLYPH[String(species ?? '')] ?? '🐾'
}

/** For the Equipment card — a tractor is the closest thing a farm has to a default implement. */
const EQUIPMENT_GLYPH: Record<string, string> = {
  Tractor: '🚜', Attachment: '🔧', Vehicle: '🚗', Other: '🛠️',
}

export function equipmentGlyph(kind: string | null): string {
  return EQUIPMENT_GLYPH[String(kind ?? '')] ?? '🚜'
}

/* ------------------------------------------------------------- breeding */

export interface Gestation {
  /** Days from the breeding (or from setting eggs) to the young arriving. */
  days: number
  /** The same span in the words a stockman actually uses. */
  phrase: string
  /** A sow is pregnant; a hen is just sitting on eggs. */
  kind: 'gestation' | 'incubation'
  /** The verb for the event — "due to farrow", not "due to give birth". */
  verb: string
}

/**
 * How long each species carries, in days.
 *
 * These are the working averages a farm plans around, not a claim to the
 * hour: a sow really does go "three months, three weeks and three days"
 * (114), a cow lands around 283, a ewe around 147. Anything under a week
 * either side of the date is ordinary, which is why the Due date is shown
 * with that caveat attached rather than as a deadline.
 *
 * Birds are here too, measured from the day the eggs were set rather than
 * from any mating — the arithmetic a farm wants is identical ("when do
 * these hatch"), the biology is not, so `kind` keeps the wording honest.
 *
 * A species absent from this table (anything a farm typed in itself) simply
 * gets no due-date arithmetic offered — a made-up number would be worse
 * than no number.
 */
export const GESTATION: Record<string, Gestation> = {
  Cattle:  { days: 283, phrase: 'about 9 months',                  kind: 'gestation',   verb: 'calve' },
  Pig:     { days: 114, phrase: '3 months, 3 weeks and 3 days',    kind: 'gestation',   verb: 'farrow' },
  Sheep:   { days: 147, phrase: 'about 5 months',                  kind: 'gestation',   verb: 'lamb' },
  Goat:    { days: 150, phrase: 'about 5 months',                  kind: 'gestation',   verb: 'kid' },
  Horse:   { days: 340, phrase: 'about 11 months',                 kind: 'gestation',   verb: 'foal' },
  Donkey:  { days: 365, phrase: 'about 12 months',                 kind: 'gestation',   verb: 'foal' },
  Rabbit:  { days: 31,  phrase: 'about a month',                   kind: 'gestation',   verb: 'kindle' },
  Alpaca:  { days: 335, phrase: 'about 11 months',                 kind: 'gestation',   verb: 'give birth' },
  Llama:   { days: 350, phrase: 'about 11 and a half months',      kind: 'gestation',   verb: 'give birth' },
  Bison:   { days: 285, phrase: 'about 9 and a half months',       kind: 'gestation',   verb: 'calve' },
  Chicken: { days: 21,  phrase: '3 weeks',                         kind: 'incubation',  verb: 'hatch' },
  Duck:    { days: 28,  phrase: '4 weeks',                         kind: 'incubation',  verb: 'hatch' },
  Goose:   { days: 30,  phrase: 'about a month',                   kind: 'incubation',  verb: 'hatch' },
  Turkey:  { days: 28,  phrase: '4 weeks',                         kind: 'incubation',  verb: 'hatch' },
  Quail:   { days: 17,  phrase: 'about 17 days',                   kind: 'incubation',  verb: 'hatch' },
}

export function gestationFor(species: string | undefined | null): Gestation | null {
  return GESTATION[String(species ?? '')] ?? null
}

/**
 * When the young are expected, or null for a species with no known term.
 *
 * Fixed at noon, the same hour EditAsset writes a birthday at: adding
 * whole days to a midnight timestamp lands on the previous evening the
 * moment a daylight-saving boundary falls inside a nine-month gestation,
 * and "due Jan 2" quietly becoming "due Jan 1" is exactly the kind of
 * silent off-by-one a farmer would never think to check for.
 */
export function dueDate(
  bredOn: Date | string, species: string | undefined | null,
): Date | null {
  const term = gestationFor(species)
  if (!term) return null
  const from = new Date(bredOn)
  if (Number.isNaN(from.getTime())) return null
  const due = new Date(from.getFullYear(), from.getMonth(), from.getDate() + term.days, 12)
  return due
}

/**
 * Whole days from today to `due` — negative once it's past. Both ends are
 * flattened to local midnight first, so "tomorrow" is 1 whether it's read
 * at breakfast or at midnight, rather than rounding off a part-day.
 */
export function daysUntil(due: Date, from: Date = new Date()): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

/**
 * The countdown beside a due date: "in 12 days", "today", "3 days overdue".
 *
 * Weeks and months are deliberately not used — a sow due "in 3 months" is
 * no help to somebody deciding whether the farrowing pen needs bedding
 * this week. Past due says "overdue" rather than "3 days ago": the date
 * hasn't merely passed, the animal is still carrying.
 */
export function dueLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 0) return `in ${days} days`
  return days === -1 ? '1 day overdue' : `${-days} days overdue`
}

/**
 * Whether a breeding is still worth showing as "expecting".
 *
 * A breeding log is history and stays in the log forever, but the panel
 * built on it has to stop at some point: either she delivered (and the
 * births got recorded as their own animals) or she never settled, and
 * neither outcome is something the app can be sure of on its own. Two
 * weeks past due is long enough to cover a genuinely late birth and short
 * enough that nothing sits there claiming a cow is pregnant a year on.
 */
export const OVERDUE_GRACE_DAYS = 14

/**
 * How much warning a birth gets on the Today screen: a month, or the whole
 * term where that is shorter than a month.
 *
 * A sow bred today is due in 114 days, and a chore list that says so from
 * day one is a chore list nobody reads. A month is about when a farm
 * starts doing something about it — bedding the farrowing pen, moving her
 * up — and for a clutch of eggs, three weeks IS the whole story, so the
 * shorter term wins rather than being rounded up to a month it never had.
 */
export function leadDays(term: Gestation): number {
  return Math.min(30, term.days)
}

/**
 * A breeding turned into a due date, or null if it is not worth showing
 * yet (or any more).
 *
 * Takes anything carrying a species and a breeding date — a row out of
 * expectedBirths(), typically — and hands back the same object with the
 * arithmetic attached, so the caller keeps whatever else it was carrying
 * (a name, an id, the sire) without this having to know about any of it.
 */
export function upcomingBirth<T extends { species: string | null; bredOn: string }>(
  row: T, now: Date = new Date(),
): (T & { due: Date; days: number; term: Gestation }) | null {
  const term = gestationFor(row.species)
  if (!term) return null
  const due = dueDate(row.bredOn, row.species)
  if (!due) return null
  const days = daysUntil(due, now)
  if (days > leadDays(term)) return null
  // Past this, she either delivered or never settled — see OVERDUE_GRACE_DAYS.
  if (days < -OVERDUE_GRACE_DAYS) return null
  return { ...row, due, days, term }
}

/**
 * "Pigs carry 3 months, 3 weeks and 3 days." / "Chicken eggs take 3 weeks
 * to hatch." — the one line that says where a due date came from, so it
 * reads as arithmetic the farm can check rather than a number the app
 * produced out of nowhere.
 */
export function gestationSentence(species: string): string | null {
  const term = gestationFor(species)
  if (!term) return null
  return term.kind === 'incubation'
    ? `${species} eggs take ${term.phrase} to hatch.`
    : `${pluralSpecies(species)} carry ${term.phrase}.`
}
