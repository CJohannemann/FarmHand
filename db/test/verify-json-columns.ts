// Postgres returned jsonb columns as parsed objects; SQLite returns the same
// columns as TEXT. Every screen was written against the Postgres behaviour,
// so after the storage-engine migration `asset.attributes?.species` silently
// read `undefined` on every asset — species, headcount, ear tags and
// equipment details all rendered blank, and tilesFor() stopped recognising a
// laying flock or a dairy herd. push() reads through the same path, so the
// un-parsed string was also being written into the remote jsonb column as a
// JSON *string* rather than an object.
//
// db/client.ts parses these columns at the single point every read passes
// through; this pins that behaviour, including the cases where it must NOT
// touch a value.
//
//   npm run verify:json-columns
import { parseJsonColumns } from '../../src/db/json.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

console.log('\nJSON text columns come back as objects')
const [asset] = parseJsonColumns([
  { id: 'a1', name: 'Patti', attributes: '{"species":"Cattle","purpose":"dairy"}' },
])
check('attributes is an object, not a string', typeof asset.attributes === 'object')
check('a field reads through it',
  (asset.attributes as Record<string, unknown>).species === 'Cattle',
  String((asset.attributes as Record<string, unknown>).species))
check('spreading it yields fields, not characters',
  Object.keys({ ...(asset.attributes as object) }).join(',') === 'species,purpose',
  Object.keys({ ...(asset.attributes as object) }).slice(0, 4).join(','))

console.log('\nlocation.geometry gets the same treatment')
const [loc] = parseJsonColumns([{ id: 'l1', geometry: '{"type":"Point"}' }])
check('geometry is parsed',
  (loc.geometry as Record<string, unknown>)?.type === 'Point')

console.log('\nValues that must be left alone')
const [row] = parseJsonColumns([{
  attributes: null,
  geometry: undefined,
  name: 'not a json column',
}])
check('null stays null', row.attributes === null)
check('undefined stays undefined', row.geometry === undefined)
check('non-JSON columns are untouched', row.name === 'not a json column')

const [already] = parseJsonColumns([{ attributes: { species: 'Pig' } }])
check('an already-parsed object is left as-is',
  (already.attributes as Record<string, unknown>).species === 'Pig')

// A malformed blob must not take down the screen reading it.
const [bad] = parseJsonColumns([{ attributes: '{not valid json' }])
check('unparseable text is left as raw text rather than throwing',
  bad.attributes === '{not valid json', String(bad.attributes))

console.log('\nEmpty and odd inputs')
check('an empty row set is fine', parseJsonColumns([]).length === 0)
const defaulted = parseJsonColumns([{ attributes: '{}' }])
check('the default empty blob parses to an empty object',
  JSON.stringify(defaulted[0].attributes) === '{}')

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
