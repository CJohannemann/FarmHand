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
