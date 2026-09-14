// Builds db/schema.local.sql in node:sqlite and seeds it with seedLocal.ts's
// vocabulary — the local-engine counterpart of verify.mjs's schema/seed load,
// proving the SQLite dialect port (triggers, no gen_random_uuid() default,
// breed -> species parent lookups) actually works before any browser/WASM
// code depends on it.
//   npm run verify:seed-local
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary, topUpLocalVocabulary } from '../seedLocal.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
let failures = 0

const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}` +
              (ok ? '' : ` (expected ${expected})`))
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

const query = async (sql, params = []) => db.prepare(sql).run(...params)
await seedLocalVocabulary(query)

check('seeded vocabulary terms', db.prepare(`select count(*) n from term`).get().n, 150)
check('crop vocabulary present',
  db.prepare(`select count(*) n from term where vocabulary='crop'`).get().n, 43)
check('quail is a species (added after the original seed)',
  db.prepare(`select count(*) n from term where vocabulary='species' and name='Quail'`).get().n, 1)
check('bale was replaced, not just added alongside',
  db.prepare(`select count(*) n from term where vocabulary='unit' and name='bale'`).get().n, 0)
check('round bale present',
  db.prepare(`select count(*) n from term where vocabulary='unit' and name='Round Bale'`).get().n, 1)

const [angus] = db.prepare(
  `select t.name, p.name as parent from term t
     join term p on p.id = t.parent_id
    where t.vocabulary = 'breed' and t.name = 'Angus'`,
).all()
check('a breed carries its species as parent_id', angus?.parent, 'Cattle')

// Matches today's Postgres behavior: seeding isn't wrapped in `applying()`,
// so every seeded row queues in the outbox same as a real write would — a
// harmless no-op, since push() filters farm_id-null term rows out of what it
// actually sends and then clears the table's outbox regardless. Asserting
// parity here rather than "should be empty" so this migration doesn't
// silently change that pre-existing behavior.
check('seeding queues the outbox, same as today (harmless — push filters it)',
  db.prepare(`select count(*) n from sync_outbox where tbl = 'term'`).get().n, 150)

// ---------------------------------------------------------------------------
// New vocabulary has to reach a device that already exists.
//
// It cannot arrive over sync: system terms are seeded independently on both
// sides with different ids, so sync.ts filters farm_id-null rows out of the
// pull on purpose. That left the seed list as the only route, and the seed
// list only runs on a brand-new database — so "Improvements" was added to
// seedLocal.ts, to seed.sql AND to a migration, and still did not appear on
// a phone that had been running for weeks. topUpLocalVocabulary is what
// closes that, and this is the check that it stays closed.
console.log('\nAn existing device gains vocabulary added since it was set up')

const older = new DatabaseSync(':memory:')
older.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))
const olderQuery = async (sql, params = []) => older.prepare(sql).run(...params)
await seedLocalVocabulary(olderQuery)

// Take two terms away, standing in for a device seeded before they existed.
older.prepare(`delete from term where vocabulary='material' and name='Improvements'`).run()
older.prepare(`delete from term where vocabulary='unit' and name='ft'`).run()
const has = (v, n) =>
  older.prepare(`select count(*) n from term where vocabulary=? and name=?`).get(v, n).n
check('the older device is missing them', has('material', 'Improvements') + has('unit', 'ft'), 0)

const before = older.prepare(`select count(*) n from term`).get().n
await topUpLocalVocabulary(olderQuery)
check('a top-up adds the missing material', has('material', 'Improvements'), 1)
check('and the missing unit', has('unit', 'ft'), 1)
check('adding exactly what was missing, nothing more',
  older.prepare(`select count(*) n from term`).get().n, before + 2)

// The important half: running it again must not duplicate 150 terms.
await topUpLocalVocabulary(olderQuery)
check('running it twice changes nothing',
  older.prepare(`select count(*) n from term`).get().n, before + 2)
check('and leaves exactly one of each',
  older.prepare(`select count(*) n from term where vocabulary='unit' and name='ft'`).get().n, 1)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
