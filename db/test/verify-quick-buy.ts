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
  FOR_STOCK_KINDS, QUICK_KINDS, SERVICE_MATERIALS, quickPurchaseName, purchaseKindChange, purchaseLogName,
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

console.log('\nChanging a purchase\'s kind on Edit record')
{
  const gates = { origin: 'service', material: 'Building supplies', supplier: 'TSC' }
  const asFeed = purchaseKindChange(gates, 'Feed', false)
  check('the kind changes, other attributes ride through', asFeed.material === 'Feed' && asFeed.supplier === 'TSC')
  check('Building supplies re-filed as Feed becomes stock', asFeed.origin === 'purchased')
  const feed = { origin: 'purchased', material: 'Feed', category: 'Pig' }
  const asLumber = purchaseKindChange(feed, 'Building supplies', false)
  check('Feed re-filed as Building supplies leaves Stores', asLumber.origin === 'service')
  check('and drops "For: Pig", which only means something on feed', !('category' in asLumber))
  check('Feed to Hay keeps it', purchaseKindChange(feed, 'Hay', false).category === 'Pig')
  check('feed already fed out stays stock', purchaseKindChange(feed, 'Building supplies', true).origin === 'purchased')
  check('a vet visit\'s cost lot stays one', purchaseKindChange({ origin: 'service', material: 'Medicine' }, 'Feed', true).origin === 'service')
  check('produce is never turned into a purchase', purchaseKindChange({ origin: 'produced', material: 'Eggs' }, 'Feed', false).origin === 'produced')
  check('an old lot with no origin is stock', purchaseKindChange({ material: 'Feed' }, 'Utilities', false).origin === 'service')
  check('the original is not changed', gates.material === 'Building supplies' && feed.category === 'Pig')
  check('the record reads "Paid for gates"', purchaseLogName('service', ' gates ') === 'Paid for gates')
  check('or "Bought Pig feed"', purchaseLogName('purchased', 'Pig feed') === 'Bought Pig feed')
  check('an old lot with no origin is "Bought"', purchaseLogName(undefined, 'Hay') === 'Bought Hay')
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
