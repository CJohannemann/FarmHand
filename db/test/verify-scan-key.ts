// The receipt-scanning key, kept with the farm.
//
// Set once by the owner or a manager, used by everyone on the farm — a farm
// of twenty was never going to have twenty people paste a key. What is
// worth pinning: it is the farm's (another farm on the same phone has its
// own, or none), replacing it leaves one live key, turning it off sticks,
// every change is queued to sync to the other phones, and it never turns
// up among the farm's real vocabulary (the kinds, units, species).
//
// Runs the app's own statements (src/db/settingsSql.ts) under node:sqlite.
//
//   npm run verify:scan-key
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  CLEAR_SETTING_SQL, GET_SETTING_SQL, SCAN_KEY_SETTING, SET_SETTING_SQL,
} from '../../src/db/settingsSql.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const T = '2026-11-01T00:00:00.000Z'
/** $1-style placeholders expanded the way src/db/worker.ts does it. */
const sql = (text: string, params: unknown[] = []) => {
  const values: unknown[] = []
  const q = text.replace(/\$(\d+)/g, (_, n: string) => { values.push(params[Number(n) - 1]); return '?' })
  return db.prepare(q).all(...values as never[]) as Record<string, unknown>[]
}
const ours = crypto.randomUUID()
const theirs = crypto.randomUUID()
for (const f of [ours, theirs]) {
  db.prepare(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`).run(f, 'F', T, T)
}
const use = (farm: string) => {
  db.exec(`delete from active_farm`)
  db.prepare(`insert into active_farm (id) values (?)`).run(farm)
}

/** setScanKey() / getScanKey(), as queries.ts runs them. */
let tick = 0
const set = (value: string | null) => {
  sql(CLEAR_SETTING_SQL, [SCAN_KEY_SETTING])
  // A distinct time per write, as two saves seconds apart would have.
  if (value) sql(SET_SETTING_SQL, [crypto.randomUUID(), SCAN_KEY_SETTING, value, `2026-11-11T10:00:0${tick++}.000Z`])
}
const get = () => (sql(GET_SETTING_SQL, [SCAN_KEY_SETTING])[0]?.value as string | undefined) ?? null
const live = () => (sql(`select count(*) n from term where vocabulary = $1 and deleted_at is null`, [SCAN_KEY_SETTING])[0] as { n: number }).n

console.log('\nThe farm\'s key')
use(ours)
check('none to start with', get() === null)
db.exec(`delete from sync_outbox`)
set('AIzaFIRST')
check('set once, read back', get() === 'AIzaFIRST')
check('kept as the farm\'s own, not a system default',
  (sql(`select farm_id from term where name = 'AIzaFIRST'`)[0] as { farm_id: string }).farm_id === ours)
check('queued to sync to the other phones on the farm',
  (sql(`select count(*) n from sync_outbox where tbl = 'term'`)[0] as { n: number }).n === 1)

console.log('\nReplacing and turning off')
set('AIzaSECOND')
check('the new key is the one used', get() === 'AIzaSECOND')
check('and the only live one', live() === 1, String(live()))
check('the old one is soft-deleted, so its removal syncs too',
  (sql(`select deleted_at from term where name = 'AIzaFIRST'`)[0] as { deleted_at: string | null }).deleted_at !== null)
set('AIzaSECOND')
check('saving the same key again is fine', get() === 'AIzaSECOND' && live() === 1)
set(null)
check('turned off, there is no key', get() === null && live() === 0)

console.log('\nOne farm\'s key is not another\'s')
set('AIzaOURS')
use(theirs)
check('the farm next door on the same phone has none', get() === null)
set('AIzaTHEIRS')
use(ours)
check('and setting theirs leaves ours alone', get() === 'AIzaOURS')

console.log('\nIt is not part of the farm\'s vocabulary')
const materials = sql(
  `select name from term where vocabulary = 'material' and deleted_at is null
     and (farm_id is null or farm_id = (select id from active_farm))`,
)
check('not among the kinds the Buy sheet offers', !materials.some((r) => String(r.name).startsWith('AIza')))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
