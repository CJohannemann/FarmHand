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
