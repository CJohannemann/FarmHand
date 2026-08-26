/**
 * The local database's starting vocabulary — the union of db/seed.sql plus
 * every vocabulary migration that followed it on the Postgres side
 * (002_crop_vocabulary, 004_quail, 005_bale_units, 006_equipment), collapsed
 * into the current-state list. The local database is always built fresh (see
 * schema.local.sql), so there is no existing install to upgrade in place the
 * way those migrations upgrade a live Postgres database — 'bale' from the
 * original seed is left out entirely rather than seeded and then retired,
 * since 005 replaced it with Square Bale / Round Bale before any local
 * database will ever read this file.
 *
 * A plain data-plus-loader module, not a .sql file: ids need
 * `crypto.randomUUID()`, which SQLite has no column-default equivalent for
 * (unlike Postgres's `gen_random_uuid()`), and a JS-driven loop is simpler
 * and more portable than depending on every target SQLite build supporting a
 * registered custom SQL function. Shared verbatim between the real app
 * (src/db/worker.ts) and the Node verification harness (db/test), so there
 * is exactly one copy of this list.
 */

const SPECIES = [
  'Cattle', 'Pig', 'Chicken', 'Turkey', 'Duck', 'Goose',
  'Sheep', 'Goat', 'Rabbit', 'Horse', 'Honeybee', 'Quail',
]

const BREEDS: [name: string, species: string][] = [
  ['Angus', 'Cattle'], ['Hereford', 'Cattle'], ['Jersey', 'Cattle'],
  ['Highland', 'Cattle'], ['Dexter', 'Cattle'],
  ['Berkshire', 'Pig'], ['Tamworth', 'Pig'], ['Duroc', 'Pig'],
  ['Large Black', 'Pig'], ['Kunekune', 'Pig'],
  ['Rhode Island Red', 'Chicken'], ['Barred Rock', 'Chicken'],
  ['Buff Orpington', 'Chicken'], ['Australorp', 'Chicken'],
  ['Cornish Cross', 'Chicken'], ['Freedom Ranger', 'Chicken'],
  ['Easter Egger', 'Chicken'],
  ['Katahdin', 'Sheep'], ['Dorper', 'Sheep'],
  ['Nigerian Dwarf', 'Goat'], ['Boer', 'Goat'],
]

const MATERIALS = [
  'Feed', 'Hay', 'Straw', 'Bedding', 'Seed', 'Fertilizer', 'Compost',
  'Medicine', 'Mineral', 'Fuel', 'Meat', 'Eggs', 'Milk', 'Honey', 'Produce',
  'Firewood', 'Canning supplies', 'Parts',
]

const METHODS = [
  'Butchering', 'Canning', 'Freezing', 'Curing', 'Smoking', 'Fermenting',
  'Dehydrating', 'Rendering', 'Pressing', 'Milling', 'Cheesemaking',
]

const TREATMENTS = [
  'Vaccination', 'Deworming', 'Antibiotic', 'Hoof trim',
  'Castration', 'Dehorning', 'Mite treatment',
]

const SERVICE = [
  'Oil change', 'Filter', 'Tires', 'Repair', 'Inspection', 'Registration', 'Other',
]

const UNITS = [
  'lb', 'oz', 'kg', 'g', 'ton', 'gal', 'qt', 'pt', 'fl oz', 'L', 'mL',
  'head', 'dozen', 'each', 'Square Bale', 'Round Bale', 'bushel', 'jar',
  'acre', 'sq ft', 'ha', 'hour', 'minute', 'USD',
]

const CROPS = [
  'Tomato', 'Lettuce', 'Spinach', 'Kale', 'Cabbage', 'Broccoli',
  'Cauliflower', 'Carrot', 'Beet', 'Radish', 'Turnip', 'Potato',
  'Sweet potato', 'Onion', 'Garlic', 'Leek', 'Bean', 'Pea', 'Sweet corn',
  'Squash', 'Pumpkin', 'Cucumber', 'Melon', 'Pepper', 'Eggplant',
  'Asparagus', 'Rhubarb', 'Strawberry', 'Raspberry', 'Blueberry', 'Apple',
  'Pear', 'Peach', 'Plum', 'Grape', 'Herbs', 'Hay', 'Pasture', 'Cover crop',
  'Wheat', 'Oats', 'Rye', 'Sunflower',
]

export interface SeedQuery {
  (sql: string, params?: unknown[]): Promise<unknown>
}

/** Inserts the starting vocabulary. Call exactly once, on a freshly created local database. */
export async function seedLocalVocabulary(query: SeedQuery): Promise<void> {
  const now = new Date().toISOString()
  const term = (vocabulary: string, name: string, parentId: string | null = null) =>
    query(
      `insert into term (id, farm_id, vocabulary, name, parent_id, created_at, updated_at)
       values (?, null, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), vocabulary, name, parentId, now, now],
    )

  const speciesId: Record<string, string> = {}
  for (const name of SPECIES) {
    const id = crypto.randomUUID()
    speciesId[name] = id
    await query(
      `insert into term (id, farm_id, vocabulary, name, created_at, updated_at)
       values (?, null, 'species', ?, ?, ?)`,
      [id, name, now, now],
    )
  }
  for (const [name, species] of BREEDS) await term('breed', name, speciesId[species])
  for (const name of MATERIALS) await term('material', name)
  for (const name of METHODS) await term('method', name)
  for (const name of TREATMENTS) await term('treatment', name)
  for (const name of SERVICE) await term('service', name)
  for (const name of UNITS) await term('unit', name)
  for (const name of CROPS) await term('crop', name)
}
