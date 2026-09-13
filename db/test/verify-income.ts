// What counts as money in.
//
// There are two ways to sell on this farm and they write different log
// types. Closing out an animal writes a `sale`. Selling produce off the
// Sell tile draws it out of Stores, which writes a `disposition` — and
// costEntries used to count log types, so every dozen eggs sold recorded
// its price and then never appeared in Money in. The chart said $0.00 over
// a month with real sales in it.
//
// The fix cannot simply be "count dispositions too": the same log type
// covers eating it at home, giving it away, trading, feeding it back and
// spoilage. Some of those carry a value (what it was worth), and counting
// those as income would overstate what the farm earned — which is a worse
// failure than the one being fixed, because it is believable.
//
// So this pins both halves: sold dispositions are income, every other kind
// is not, and a purchase is still money out.
//
//   npm run verify:income
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { fileURLToPath } from 'url'

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
run(`insert into farm (id, name, created_at, updated_at) values (?,?,?,?)`, [farm, 'Ours', now(), now()])
run(`insert into active_farm (id) values (?)`, [farm])

// A lot of eggs the farm produced, to draw from.
const eggs = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'lot','Eggs',?,?,?)`,
  [eggs, farm, JSON.stringify({ origin: 'produced', material: 'Eggs' }), now(), now()])

/** recordDisposition(), as it now writes them. */
const disposition = (kind: string, label: string, value: number | null, legacy = false) => {
  const id = uuid()
  run(`insert into log (id, farm_id, type, timestamp, status, name, attributes, created_at, updated_at)
       values (?,?,'disposition',?,'done',?,?,?,?)`,
    // `legacy` writes the row the way it was written before the kind was
    // stored — label only, no attributes — which is what the fallback in
    // costEntries exists for.
    [id, farm, '2026-03-01T12:00:00.000Z', label,
      legacy ? '{}' : JSON.stringify({ disposition: kind }), now(), now()])
  run(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`, [id, eggs])
  if (value !== null) {
    run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
         values (?,?,?,'price',?,'USD',?,?)`, [uuid(), farm, id, value, now(), now()])
  }
  return id
}

// costEntries(), copied from src/db/queries.ts.
const costEntries = () => q(
  `select l.timestamp, q.value as value,
          case when l.type = 'purchase' then 'purchase' else 'sale' end as kind,
          coalesce(
            (select coalesce(a.attributes->>'category',
                             a.attributes->>'material',
                             a.attributes->>'species',
                             a.attributes->>'kind')
               from log_asset la join asset a on a.id = la.asset_id
              where la.log_id = l.id and la.role = 'subject'
              limit 1),
            'Other') as material
     from log l
     join quantity q on q.log_id = l.id and q.deleted_at is null
          and q.measure = 'price'
    where l.deleted_at is null
      and l.farm_id = (select id from active_farm)
      and (l.type in ('purchase', 'sale')
           or (l.type = 'disposition'
               and coalesce(l.attributes->>'disposition', l.name) in ('sold', 'Sold')))
    order by l.timestamp asc`,
) as { value: number; kind: string; material: string }[]

const income = () => costEntries().filter((e) => e.kind === 'sale')
  .reduce((n, e) => n + e.value, 0)
const spend = () => costEntries().filter((e) => e.kind === 'purchase')
  .reduce((n, e) => n + e.value, 0)

// ---------------------------------------------------------------------------
console.log('\nSelling produce off the Sell tile is money in')

disposition('sold', 'Sold', 8)
check('a sold disposition counts as income', income() === 8, String(income()))
check('and lands under the lot\'s own material',
  income() > 0 && costEntries()[0].material === 'Eggs', costEntries()[0]?.material)

// ---------------------------------------------------------------------------
console.log('\nEverything else that leaves Stores is NOT income')

// Each of these carries a value — what it was worth — which is exactly why
// counting the log type alone would overstate the farm's earnings.
disposition('home_use', 'Used at home', 12)
disposition('given', 'Given away', 15)
disposition('traded', 'Traded', 20)
disposition('lost', 'Lost or spoiled', 30)
disposition('fed_back', 'Fed to livestock', 25)

check('eating it at home is not a sale', income() === 8, String(income()))
check('nor is giving it away', income() === 8)
check('nor trading it', income() === 8)
check('nor spoilage', income() === 8)
check('nor feeding it back', income() === 8)
check('only the one real sale is counted', costEntries().length === 1)

// ---------------------------------------------------------------------------
console.log('\nRows written before the kind was stored still work')

// name only, no attributes.disposition — the fallback path.
disposition('sold', 'Sold', 5, true)
check('a legacy "Sold" row still counts', income() === 13, String(income()))
disposition('given', 'Given away', 99, true)
check('and a legacy giveaway still does not', income() === 13, String(income()))

// ---------------------------------------------------------------------------
console.log('\nThe other direction is untouched')

const cow = uuid()
run(`insert into asset (id, farm_id, type, name, attributes, created_at, updated_at)
     values (?,?,'animal','Bluebell',?,?,?)`,
  [cow, farm, JSON.stringify({ species: 'Cattle' }), now(), now()])

const buy = uuid()
run(`insert into log (id, farm_id, type, timestamp, status, name, created_at, updated_at)
     values (?,?,'purchase',?,'done','Bought Bluebell',?,?)`,
  [buy, farm, '2026-02-01T12:00:00.000Z', now(), now()])
run(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`, [buy, cow])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
     values (?,?,?,'price',1500,'USD',?,?)`, [uuid(), farm, buy, now(), now()])

check('a purchase is still money out', spend() === 1500, String(spend()))
check('and is not counted as income', income() === 13, String(income()))

// Closing out an animal — the other way to sell — still counts.
const sale = uuid()
run(`insert into log (id, farm_id, type, timestamp, status, name, created_at, updated_at)
     values (?,?,'sale',?,'done','Sold Bluebell',?,?)`,
  [sale, farm, '2026-04-01T12:00:00.000Z', now(), now()])
run(`insert into log_asset (log_id, asset_id, role) values (?,?,'subject')`, [sale, cow])
run(`insert into quantity (id,farm_id,log_id,measure,value,unit,created_at,updated_at)
     values (?,?,?,'price',1800,'USD',?,?)`, [uuid(), farm, sale, now(), now()])

check('closing out an animal is income', income() === 1813, String(income()))
check('both ways of selling land in the same bucket',
  income() === 13 + 1800)

db.close()
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
