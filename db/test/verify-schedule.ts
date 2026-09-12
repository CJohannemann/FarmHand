// The Schedule calendar: what lands on a day, and what must not.
//
// The grid arithmetic is not what is worth guarding — a wrong offset is
// visible the moment anyone opens the screen. What is worth guarding is
// the handful of things that are silently wrong:
//
//  1. loggedEvents() must be farm-scoped and must exclude cancelled
//     chores. A dropped chore says it was never done; showing it on the
//     calendar as if it had been is a lie about the farm's history.
//  2. A completed chore belongs on the day it was TICKED, not the day it
//     was due — completeTask() overwrites the timestamp, and a calendar
//     of "what took place" has to agree with that.
//  3. A birth two months out must still be placeable. upcomingBirth()
//     returns null past ~30 days, which is right for Today's list and
//     would silently empty a month being looked at from a distance. This
//     is the regression the screen's design exists to avoid, so it gets a
//     test that fails if anyone "simplifies" it back.
//  4. A late-evening log belongs to the farm's calendar day, not the
//     viewer's.
//
// Raw SQL against schema.local.sql, the same as every other verify-*-local
// test: queries.ts talks to the wa-sqlite worker, which has no Node
// equivalent. The statements below are copied from it.
//
//   npm run verify:schedule
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dueDate, daysUntil, upcomingBirth } from '../../src/lib/husbandry.ts'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const q = (sql: string, params: unknown[] = []) =>
  db.prepare(sql).all(...params as never[]) as never[]
const run = (sql: string, params: unknown[] = []) =>
  db.prepare(sql).run(...params as never[])

const farm = uuid()
const other = uuid()
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Ours', now(), now()])
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [other, 'Theirs', now(), now()])
run(`insert into active_farm (id) values (?)`, [farm])

const addLog = (
  farmId: string, type: string, status: string, name: string, ts: string,
) => {
  const id = uuid()
  run(`insert into log (id, farm_id, type, timestamp, status, name, created_at, updated_at)
       values (?,?,?,?,?,?,?,?)`, [id, farmId, type, ts, status, name, now(), now()])
  return id
}

// loggedEvents(), copied from src/db/queries.ts.
const loggedEvents = (from: string, to: string) => q(
  `select l.id, l.type, l.name, l.timestamp
     from log l
    where l.deleted_at is null and l.status = 'done'
      and l.type in ('activity', 'birth')
      and l.farm_id = (select id from active_farm)
      and l.timestamp >= ? and l.timestamp <= ?
    order by l.timestamp asc`,
  [from, to],
) as { id: string; type: string; name: string; timestamp: string }[]

const JAN = '2026-01-01T00:00:00.000Z'
const FEB = '2026-02-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
console.log('\nWhat a past day carries')

addLog(farm, 'activity', 'done', 'Wormed the cattle', '2026-01-10T14:00:00.000Z')
addLog(farm, 'birth', 'done', 'Born', '2026-01-12T12:00:00.000Z')
const names = () => loggedEvents(JAN, FEB).map((r) => r.name).sort()

check('a completed chore shows', names().includes('Wormed the cattle'))
check('and a birth that happened', names().includes('Born'))

// Everything that must NOT show.
addLog(farm, 'activity', 'cancelled', 'Dropped chore', '2026-01-14T09:00:00.000Z')
check('a DROPPED chore never shows — it was not done',
  !names().includes('Dropped chore'))

addLog(farm, 'activity', 'planned', 'Still to do', '2026-01-20T09:00:00.000Z')
check('an outstanding chore is not a past event (it comes from plannedLogs)',
  !names().includes('Still to do'))

addLog(farm, 'input_application', 'done', 'Fed', '2026-01-11T08:00:00.000Z')
addLog(farm, 'harvest', 'done', 'Eggs collected', '2026-01-11T08:00:00.000Z')
check('an ordinary feeding does not dot the calendar', !names().includes('Fed'))
check('nor does an egg collection', !names().includes('Eggs collected'))

addLog(other, 'activity', 'done', "Neighbour's chore", '2026-01-15T09:00:00.000Z')
check("another farm's chore does not leak in", !names().includes("Neighbour's chore"))

addLog(farm, 'activity', 'done', 'Last month', '2025-12-28T09:00:00.000Z')
check('nor does one outside the month asked for', !names().includes('Last month'))

// ---------------------------------------------------------------------------
console.log('\nA chore ticked late lands on the day it was done')

// Planned for the 3rd...
const late = addLog(farm, 'activity', 'planned', 'Fix the gate', '2026-01-03T09:00:00.000Z')
// ...ticked on the 7th. completeTask() overwrites the timestamp, which is
// what makes the calendar say when it actually happened.
run(`update log set status = 'done', timestamp = ?, updated_at = ? where id = ?`,
  ['2026-01-07T16:30:00.000Z', now(), late])

const fixed = loggedEvents(JAN, FEB).find((r) => r.name === 'Fix the gate')
check('it is a past event now', !!fixed)
check('dated the day it was ticked, not the day it was due',
  fixed?.timestamp.startsWith('2026-01-07') === true, fixed?.timestamp)

// ---------------------------------------------------------------------------
console.log('\nA birth months out is still placeable')

// A cow bred today is due in ~283 days — far past upcomingBirth()'s lead.
const bredOn = new Date()
const due = dueDate(bredOn, 'Cattle')
check('dueDate() gives a date for a distant breeding', due !== null)
check('and it is months away', due !== null && daysUntil(due) > 200,
  due ? String(daysUntil(due)) : 'null')

// The trap this screen exists to avoid: Today's helper deliberately hides
// anything this far out, so a calendar built on it would show nothing.
const soon = upcomingBirth({ species: 'Cattle', bredOn: bredOn.toISOString() })
check('upcomingBirth() correctly hides it from Today\'s "due soon" list',
  soon === null)
check('so Schedule must not be built on upcomingBirth — dueDate is the primitive',
  due !== null && soon === null)

// A birth already within the lead window still works through both.
const nearlyDue = new Date()
nearlyDue.setDate(nearlyDue.getDate() - 275)
check('a cow due within the month appears in both',
  upcomingBirth({ species: 'Cattle', bredOn: nearlyDue.toISOString() }) !== null
  && dueDate(nearlyDue, 'Cattle') !== null)

// ---------------------------------------------------------------------------
console.log('\nA day key follows the farm, not the viewer')

// dayKeyOf() from src/screens/LogList.tsx, which Schedule reuses.
const dayKeyOf = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d)

// 8pm on the 10th in Chicago is already the 11th in UTC.
const evening = new Date('2026-01-11T02:00:00.000Z')
check('a late-evening entry belongs to the farm\'s day',
  dayKeyOf(evening, 'America/Chicago') === '2026-01-10',
  dayKeyOf(evening, 'America/Chicago'))
check('and would be filed a day later by a UTC reader',
  dayKeyOf(evening, 'UTC') === '2026-01-11')

db.close()
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
