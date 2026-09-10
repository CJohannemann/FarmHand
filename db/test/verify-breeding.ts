// Who is expecting, out of the log.
//
// expectedBirths() answers one question — "the latest breeding on every
// animal still here" — and every part of that phrase is load-bearing. A
// sow bred three seasons running must appear once, on this season; a cow
// sold in the autumn must not appear at all; and the sire has to come off
// the breeding log itself rather than the dam's own record, because she
// may go to a different bull next year.
//
// Runs the exact SQL out of src/db/queries.ts against db/schema.local.sql
// in node:sqlite, the same way verify-local.mjs does — read as text rather
// than imported, since queries.ts talks to a database client this test has
// no way to stand up.
//
//   npm run verify:breeding
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dueDate, upcomingBirth } from '../../src/lib/husbandry.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

/**
 * The query under test, lifted out of queries.ts by name so this cannot
 * quietly go on testing a copy of SQL the app stopped running. `$1`-style
 * placeholders would need rewriting for node:sqlite — this one takes no
 * parameters, and the extraction asserts as much.
 */
function sqlFor(fn: string): string {
  const src = fs.readFileSync(R + '../src/db/queries.ts', 'utf8')
  const at = src.indexOf(`export async function ${fn}(`)
  if (at < 0) throw new Error(`${fn} is gone from queries.ts`)
  const open = src.indexOf('`', at)
  const close = src.indexOf('`', open + 1)
  const sql = src.slice(open + 1, close)
  if (sql.includes('$1')) throw new Error(`${fn} now takes parameters — teach this test how`)
  return sql
}

db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

const uuid = () => crypto.randomUUID()
const stamp = () => new Date().toISOString()
const run = (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params as never[])

const farm = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`,
  [farm, 'Test', stamp(), stamp()])
run(`insert into active_farm (id) values (?)`, [farm])

const other = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`,
  [other, 'The neighbour', stamp(), stamp()])

const animal = (name: string, species: string, sex: string, opts: {
  status?: string; farmId?: string; external?: boolean
} = {}) => {
  const id = uuid()
  const attrs = JSON.stringify({ species, sex, ...(opts.external ? { external: true } : {}) })
  run(`insert into asset (id, farm_id, type, name, status, attributes, created_at, updated_at)
       values (?,?,'animal',?,?,?,?,?)`,
    [id, opts.farmId ?? farm, name, opts.status ?? 'active', attrs, stamp(), stamp()])
  return id
}

const bred = (damId: string, on: string, opts: {
  sireId?: string; status?: string; deleted?: boolean; farmId?: string
} = {}) => {
  const id = uuid()
  run(`insert into log (id, farm_id, type, timestamp, status, name, created_at, updated_at, deleted_at)
       values (?,?,'breeding',?,?,'Bred',?,?,?)`,
    [id, opts.farmId ?? farm, on, opts.status ?? 'done', stamp(), stamp(),
      opts.deleted ? stamp() : null])
  run(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`, [id, damId])
  if (opts.sireId) {
    run(`insert into log_asset (log_id, asset_id, role) values (?,?,'input')`, [id, opts.sireId])
  }
  return id
}

const duke = animal('Duke', 'Cattle', 'Bull')
const boar = animal('Hamlet', 'Pig', 'Boar', { external: true })

const sadie = animal('Sadie', 'Pig', 'Sow')
bred(sadie, '2024-03-01T12:00:00.000Z')       // two seasons ago
bred(sadie, '2025-02-01T12:00:00.000Z')       // last season
bred(sadie, '2026-09-01T12:00:00.000Z', { sireId: boar })   // this one

const bessie = animal('Bessie', 'Cattle', 'Cow')
bred(bessie, '2026-01-15T12:00:00.000Z', { sireId: duke })

// Sold in the autumn — off the list entirely, whatever her log says.
const gone = animal('Ruby', 'Cattle', 'Cow', { status: 'archived' })
bred(gone, '2026-02-01T12:00:00.000Z')

// A breeding someone deleted, and one still only planned: neither is a
// record that she was bred.
const maybe = animal('Clover', 'Goat', 'Doe')
bred(maybe, '2026-05-01T12:00:00.000Z', { deleted: true })
bred(maybe, '2026-06-01T12:00:00.000Z', { status: 'planned' })

// The neighbour's farm, on the same device.
const theirs = animal('Not yours', 'Pig', 'Sow', { farmId: other })
bred(theirs, '2026-08-01T12:00:00.000Z', { farmId: other })

type Row = {
  assetId: string; name: string; species: string | null; bredOn: string; sire: string | null
}
const rows = db.prepare(sqlFor('expectedBirths')).all() as unknown as Row[]
const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

console.log('\nOne row per animal, on her latest breeding')
check('Sadie and Bessie are expecting', rows.length === 2,
  rows.map((r) => r.name).join(', ') || 'nothing came back')
check('Sadie appears once, not three times',
  rows.filter((r) => r.name === 'Sadie').length === 1)
check('and it is this season, not 2024',
  byName.Sadie?.bredOn === '2026-09-01T12:00:00.000Z', byName.Sadie?.bredOn)

console.log('\nWhat is left out')
check('an animal sold or dead is not expecting', !byName.Ruby)
check('a deleted breeding is not a breeding', !byName.Clover)
check("the neighbour's farm stays on the neighbour's farm", !byName['Not yours'])

console.log('\nThe sire comes off the breeding, not off the dam')
check('Sadie was bred to Hamlet', byName.Sadie?.sire === 'Hamlet', String(byName.Sadie?.sire))
check('Bessie to Duke', byName.Bessie?.sire === 'Duke', String(byName.Bessie?.sire))
check('and a breeding with no sire recorded says so, rather than guessing',
  bred(animal('Nell', 'Sheep', 'Ewe'), '2026-09-05T12:00:00.000Z')
  && (db.prepare(sqlFor('expectedBirths')).all() as unknown as Row[])
    .find((r) => r.name === 'Nell')?.sire === null)

console.log('\nThe species travels with the row, so a due date can be worked out')
check('Sadie is a Pig', byName.Sadie?.species === 'Pig', String(byName.Sadie?.species))
check("and her due date is her breeding date plus a sow's term",
  dueDate(byName.Sadie!.bredOn, byName.Sadie!.species)?.toDateString() === 'Thu Dec 24 2026',
  String(dueDate(byName.Sadie!.bredOn, byName.Sadie!.species)?.toDateString()))

// The window rule, against rows shaped exactly like the ones above.
console.log('\nWhat reaches the chore list, and when')
const on = (iso: string) => new Date(iso)
const sow = { species: 'Pig', bredOn: '2026-09-01T12:00:00.000Z' }
check('a sow bred today is not on the list for months',
  upcomingBirth(sow, on('2026-09-01T12:00:00.000Z')) === null)
// She is due Dec 24, so a month's notice starts Nov 24 — and the day
// before that, the list should still say nothing.
check('she arrives a month out',
  upcomingBirth(sow, on('2026-11-24T09:00:00'))?.days === 30)
check('the day before that, she has not',
  upcomingBirth(sow, on('2026-11-23T09:00:00')) === null)
check('a fortnight overdue she is still shown, in case she is just late',
  upcomingBirth(sow, on('2027-01-07T09:00:00'))?.days === -14)
check('after that she drops off — she either farrowed or never settled',
  upcomingBirth(sow, on('2027-01-08T09:00:00')) === null)
// A clutch of eggs is a three-week affair start to finish; a month's lead
// would put it on the list before it was set.
const clutch = { species: 'Chicken', bredOn: '2026-09-01T12:00:00.000Z' }
check('eggs set today are on the list today — three weeks IS the notice',
  upcomingBirth(clutch, on('2026-09-01T12:00:00.000Z'))?.days === 21)
check('a species with no known term never reaches the list',
  upcomingBirth({ species: 'Water buffalo', bredOn: '2026-09-01T12:00:00.000Z' }) === null)
check('nor does one with no species at all',
  upcomingBirth({ species: null, bredOn: '2026-09-01T12:00:00.000Z' }) === null)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
