// The search box's matching.
//
// Substring matching would have been a third of this code. It is worth the
// difference because someone reaching for search is half-remembering a
// name, not spelling it — "crkcorn" for Cracked corn, "sprlay" for Spring
// layers. What that forgiveness costs is precision, so most of what is
// pinned here is ORDER: a looser matcher that buries the obvious answer
// under six near-misses is worse than no search at all.
//
// Scores themselves are deliberately not asserted. They are tuning, and a
// test that pins them turns every future adjustment into a failing test
// that gets edited to match rather than read.
//
//   npm run verify:fuzzy
import { fuzzyScore, rank } from '../../src/lib/fuzzy.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
console.log('\nIt finds what a substring search would not')

check('"crkcorn" finds Cracked corn', fuzzyScore('crkcorn', 'Cracked corn') !== null)
check('"sprlay" finds Spring layers', fuzzyScore('sprlay', 'Spring layers') !== null)
check('"pigfd" finds Pig feed', fuzzyScore('pigfd', 'Pig feed') !== null)
check('and a plain fragment still works',
  fuzzyScore('corn', 'Cracked corn') !== null)

console.log('\nAnd it still says no')

check('letters that are not there', fuzzyScore('xyz', 'Cracked corn') === null)
check('letters out of order', fuzzyScore('nrocs', 'Cracked corn') === null)
// Not 'ccc' — cra(c)ked (c)orn genuinely holds three, so that would match.
check('more of a letter than the text has',
  fuzzyScore('kkk', 'Cracked corn') === null)
check('an empty query matches nothing rather than everything',
  fuzzyScore('', 'Cracked corn') === null)
check('and so does whitespace', fuzzyScore('   ', 'Cracked corn') === null)

// ---------------------------------------------------------------------------
console.log('\nThe obvious answer comes back on top')

const score = (q: string, t: string) => fuzzyScore(q, t) ?? -Infinity

check('an exact match beats a prefix',
  score('hay', 'Hay') > score('hay', 'Hay bales'))
check('a prefix beats a match further in',
  score('corn', 'Corn, cracked') > score('corn', 'Cracked corn'))
// The tier that exists because greedy left-to-right matching would
// otherwise score a real fragment as if it were scattered letters.
check('a real fragment beats letters gathered from all over',
  score('corn', 'Cracked corn') > score('corn', 'Chickens over rain now'))
check('a tight match beats a scattered one',
  score('corn', 'Cracked corn') > score('corn', 'Chickens of our own'))
check('a shorter name wins all else equal',
  score('feed', 'Pig feed') > score('feed', 'Pig feed for the weaners'))

// ---------------------------------------------------------------------------
console.log('\nRanking a real shelf')

const stores = [
  'Chicken feed', 'Chicken Scratch', 'Cracked corn', 'Pig feed',
  'Round bales 26', 'Mineral Block', 'Eggs, Spring layers 26',
]
const top = (q: string) => rank(q, stores, (s) => [s])[0]

check('"corn" lands on Cracked corn', top('corn') === 'Cracked corn', String(top('corn')))
check('"chick" lands on a chicken feed',
  String(top('chick')).startsWith('Chicken'), String(top('chick')))
check('"pig" lands on Pig feed', top('pig') === 'Pig feed', String(top('pig')))
check('"mineral" lands on Mineral Block',
  top('mineral') === 'Mineral Block', String(top('mineral')))
check('"crkcorn" still lands on Cracked corn',
  top('crkcorn') === 'Cracked corn', String(top('crkcorn')))

const hits = rank('feed', stores, (s) => [s])
check('every feed comes back for "feed"', hits.length >= 2, `${hits.length} hits`)
check('and nothing that is not one', !hits.includes('Mineral Block'))

// ---------------------------------------------------------------------------
console.log('\nSpelling it the easy way still works')

check('case is ignored', fuzzyScore('CRACKED', 'cracked corn') !== null)
check('accents are ignored', fuzzyScore('cafe', 'Café bales') !== null)
check('and in the other direction', fuzzyScore('café', 'Cafe bales') !== null)
check('surrounding spaces are trimmed', fuzzyScore('  corn  ', 'Cracked corn') !== null)

// ---------------------------------------------------------------------------
console.log('\nrank() reads more than one field')

interface Row { name: string; subject: string | null }
const records: Row[] = [
  { name: 'Eggs collected', subject: 'Spring layers 26' },
  { name: 'Fed', subject: 'Weaner pigs' },
  { name: 'Bought Cracked corn', subject: null },
]
const byEither = rank('weaner', records, (r) => [r.name, r.subject])
check('a record is findable by what it was about',
  byEither[0]?.name === 'Fed', byEither[0]?.name)
check('and by its own name',
  rank('eggs', records, (r) => [r.name, r.subject])[0]?.name === 'Eggs collected')
// The half that matters: a query must not be satisfied by half-matching
// one field and half another, which is what concatenating them would allow.
check('but not by straddling two fields',
  rank('eggspigs', records, (r) => [r.name, r.subject]).length === 0)
check('a null field is skipped, not crashed on',
  rank('cracked', records, (r) => [r.name, r.subject]).length === 1)

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
