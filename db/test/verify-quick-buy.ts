// The quick Buy sheet: the receipt total, what it was, where from.
//
// Two things are worth pinning. The name it saves under is chosen, never
// typed, so two people buying the same thing get the same name — "Pig feed"
// whoever buys it. And every one-tap kind has to exist in the vocabulary a
// fresh device is seeded with, or tapping it would quietly save a kind the
// farm's own lists have never heard of.
//
//   npm run verify:quick-buy
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  FOR_STOCK_KINDS, QUICK_KINDS, SERVICE_MATERIALS, quickPurchaseName,
} from '../../src/lib/purchaseKinds.ts'
import { seedLocalVocabulary, topUpLocalVocabulary } from '../seedLocal.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

console.log('\nThe name is chosen, not typed')
check('feed for pigs is "Pig feed"', quickPurchaseName('Feed', 'Pig') === 'Pig feed',
  quickPurchaseName('Feed', 'Pig'))
check('hay for cattle is "Cattle hay"', quickPurchaseName('Hay', 'Cattle') === 'Cattle hay')
check('feed for everything is just "Feed"', quickPurchaseName('Feed', '') === 'Feed'
  && quickPurchaseName('Feed', null) === 'Feed')
check('a kind that is not for one animal ignores the animal',
  quickPurchaseName('Building supplies', 'Pig') === 'Building supplies')
check('stray spaces are not part of the name', quickPurchaseName(' Feed ', ' Pig ') === 'Pig feed')

console.log('\nLumber is money spent, not stock')
check('building supplies stay out of Stores', SERVICE_MATERIALS.includes('Building supplies'))
check('feed does not', !SERVICE_MATERIALS.includes('Feed'))
check('the for-an-animal kinds are stock', FOR_STOCK_KINDS.every((k) => !SERVICE_MATERIALS.includes(k)))

console.log('\nEvery one-tap kind is in the seeded vocabulary')
const R = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(R + 'schema.local.sql', 'utf8'))
const run = (sql: string, params: unknown[] = []) => { db.prepare(sql).run(...params as never[]) }
await seedLocalVocabulary(async (sql, params) => run(sql, params))
const materials = (db.prepare(`select name from term where vocabulary = 'material'`).all() as
  { name: string }[]).map((r) => r.name)
for (const k of QUICK_KINDS) check(`"${k}" on a new device`, materials.includes(k))

// A device set up before Building supplies existed gets it on upgrade.
db.exec(`delete from term where name = 'Building supplies'`)
await topUpLocalVocabulary(async (sql, params) => run(sql, params))
check('and on a device that predates it, after the upgrade top-up',
  (db.prepare(`select count(*) n from term where name = 'Building supplies'`).get() as { n: number }).n === 1)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
