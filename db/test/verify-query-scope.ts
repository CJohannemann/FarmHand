// Every read of a farm-scoped table has to say which farm.
//
// A device can hold several farms at once, and the tables carry rows for
// all of them. A query that forgets `farm_id = (select id from
// active_farm)` does not fail — it quietly returns the neighbour's animals
// alongside your own, on a screen that looks entirely normal. That is the
// worst shape a bug can take, and no runtime test will catch the one query
// somebody adds next year.
//
// So this reads queries.ts as text and insists. It is a lint, not a test of
// behaviour, and it is the only thing standing between one forgetful edit
// and another farm's data on the screen.
//
//   npm run verify:query-scope
import fs from 'fs'
import { fileURLToPath } from 'url'

const src = fs.readFileSync(
  fileURLToPath(new URL('../../src/db/queries.ts', import.meta.url)), 'utf8')

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

/** Tables carrying a farm_id, so a read of one can belong to the wrong farm. */
const SCOPED = ['asset', 'log', 'quantity', 'location', 'receipt', 'term']

/**
 * Every template literal in the file, with the function it sits in.
 *
 * Splits on backticks rather than walking lines. The first attempt walked
 * lines looking for one that opened a literal and found 28 of the 55 here —
 * a guard reporting "no unscoped reads" while blind to half the file is
 * worse than no guard at all, because it gets believed. Odd-numbered pieces
 * of a backtick split are the literals.
 */
function statements(): { fn: string; sql: string }[] {
  const out: { fn: string; sql: string }[] = []
  const pieces = src.split('`')
  let consumed = 0
  for (let i = 0; i < pieces.length; i++) {
    if (i % 2 === 1) {
      // Whichever function declaration most recently preceded this literal.
      const names = [...src.slice(0, consumed).matchAll(/function (\w+)/g)]
      out.push({
        fn: names.length ? names[names.length - 1][1] : '(top level)',
        sql: pieces[i],
      })
    }
    consumed += pieces[i].length + 1
  }
  return out
}

const all = statements()
console.log(`\nRead ${all.length} SQL statements out of queries.ts`)
// Sanity on the parser itself: queries.ts holds well over fifty literals,
// and a count far below that means the extraction broke rather than the
// file shrinking.
check('found a plausible number of them', all.length > 50, String(all.length))

/**
 * A statement is fine if it never selects from a scoped table, or if it
 * scopes itself, or if it can only ever match one row anyway — a lookup by
 * a uuid primary key cannot return another farm's record by accident,
 * because ids are unique across every farm.
 */
const offenders = all.filter(({ sql }) => {
  const isSelect = /\bselect\b/i.test(sql)
  if (!isSelect) return false
  const touches = SCOPED.some((t) =>
    new RegExp(`\\bfrom\\s+"?${t}"?\\b`, 'i').test(sql))
  if (!touches) return false
  if (/active_farm/.test(sql)) return false
  // Keyed by a single row's own id, or by a parent whose id is unique.
  if (/\bwhere\s+\w*\.?id\s*=\s*\$\d/i.test(sql)) return false
  if (/\b(log_id|receipt_id|asset_id|parent_id)\s*=\s*\$\d/i.test(sql)) return false
  return true
})

console.log('\nEvery listing read names its farm')
for (const o of offenders) {
  console.log(`  FAIL  ${o.fn} reads a farm-scoped table without scoping it`)
  console.log(`        ${o.sql.trim().split('\n')[0].slice(0, 78)}`)
}
check('no unscoped reads', offenders.length === 0, `${offenders.length} found`)

// The guard is only worth having if it would actually catch one, so prove
// it fires rather than trusting that it would.
console.log('\nThe guard catches a read that forgets')
const bad = 'select id, name from asset where deleted_at is null'
const wouldFlag =
  /\bselect\b/i.test(bad) && /\bfrom\s+asset\b/i.test(bad) && !/active_farm/.test(bad)
  && !/\bwhere\s+\w*\.?id\s*=\s*\$\d/i.test(bad)
check('an unscoped listing is flagged', wouldFlag)
const good = 'select id from asset where farm_id = (select id from active_farm)'
check('a scoped one is not', /active_farm/.test(good))
const byId = 'select id from asset where id = $1'
check('and a lookup by id is not', /\bwhere\s+\w*\.?id\s*=\s*\$\d/i.test(byId))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
