// Builds db/schema.local.sql in node:sqlite and seeds it with seedLocal.ts's
// vocabulary — the local-engine counterpart of verify.mjs's schema/seed load,
// proving the SQLite dialect port (triggers, no gen_random_uuid() default,
// breed -> species parent lookups) actually works before any browser/WASM
// code depends on it.
//   npm run verify:seed-local
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedLocalVocabulary } from '../seedLocal.ts'

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

check('seeded vocabulary terms', db.prepare(`select count(*) n from term`).get().n, 144)
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
  db.prepare(`select count(*) n from sync_outbox where tbl = 'term'`).get().n, 144)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
