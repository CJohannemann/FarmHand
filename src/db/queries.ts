import { db } from './client'
import type {
  Asset, AssetRole, AssetType, LogWithDetail, Measure, QuantityInput,
} from './types'

let farmId: string | null = null

export async function getFarmId(): Promise<string> {
  if (farmId) return farmId
  const pg = await db()
  const { rows } = await pg.query<{ id: string }>(`select id from farm limit 1`)
  farmId = rows[0].id
  return farmId
}

export async function listTerms(vocabulary: string): Promise<string[]> {
  const pg = await db()
  const { rows } = await pg.query<{ name: string }>(
    `select name from term where vocabulary = $1 and deleted_at is null
     order by name`,
    [vocabulary],
  )
  return rows.map((r) => r.name)
}

/** Extends the farm's own vocabulary — for a kind of stock the seed list didn't guess. */
export async function createTerm(vocabulary: string, name: string): Promise<void> {
  const pg = await db()
  const farm = await getFarmId()
  const now = new Date().toISOString()
  // Every repeated value (vocabulary, name, now) is passed once per
  // occurrence rather than reused by placeholder number — SQLite driver
  // parameter binding isn't guaranteed to let one bound value satisfy two
  // occurrences of the same placeholder the way Postgres does.
  await pg.query(
    `insert into term (id, farm_id, vocabulary, name, created_at, updated_at)
     select $1, $2, $3, $4, $5, $6
     where not exists (
       select 1 from term where vocabulary = $7 and name = $8 and deleted_at is null
     )`,
    [crypto.randomUUID(), farm, vocabulary, name, now, now, vocabulary, name],
  )
}

/**
 * SQL's `order by name` sorts as text, so a group of 15 reads 1, 10, 11,
 * ..., 2, 3 — right once a name's numeric suffix hits double digits.
 * `localeCompare`'s `numeric` option treats digit runs as numbers instead,
 * putting "Spring 26 2" before "Spring 26 10" the way a person would read
 * it, while still sorting non-numeric names (Bessie, Clover) normally.
 */
function sortByStatusThenName(rows: Asset[]): Asset[] {
  return [...rows].sort((a, b) =>
    a.status.localeCompare(b.status) || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

export async function listAssets(types?: AssetType[]): Promise<Asset[]> {
  const pg = await db()
  const { rows } = await pg.query<Asset>(
    `select id, type, name, status, terminal_event, parent_id, attributes
       from asset
      where deleted_at is null
        and ($1 is null or type in (select value from json_each($2)))`,
    [types ? JSON.stringify(types) : null, JSON.stringify(types ?? [])],
  )
  return sortByStatusThenName(rows)
}

export async function createAsset(input: {
  type: AssetType
  name: string
  attributes?: Record<string, unknown>
  parentId?: string
}): Promise<string> {
  const pg = await db()
  const farm = await getFarmId()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await pg.query(
    `insert into asset (id, farm_id, type, name, attributes, parent_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id, farm, input.type, input.name,
      JSON.stringify(input.attributes ?? {}), input.parentId ?? null, now, now,
    ],
  )
  return id
}

/**
 * A sire/dam typed by name (not on this farm) becomes a minimal "external"
 * asset rather than a bare string, reusing one already saved under that
 * exact name and species if there is one — buying five calves off the
 * same outside bull means typing his name once, not five times, and every
 * one of them ends up pointing at the same record.
 */
export async function findOrCreateExternalParent(
  name: string, species: string, role: 'sire' | 'dam',
): Promise<string> {
  const trimmed = name.trim()
  const all = await listAssets(['animal'])
  const existing = all.find((a) => a.status === 'active' && a.attributes?.external
    && a.attributes?.species === species && a.name === trimmed)
  if (existing) return existing.id
  // A generic Male/Female sex (GENERIC_SEX_TERMS, recognized by sexRole()
  // regardless of species) so this stub is excluded from the *other*
  // role's picker — otherwise a bull typed in as a sire once would also
  // show up as a pickable dam later.
  const sex = role === 'sire' ? 'Male' : 'Female'
  return createAsset({ type: 'animal', name: trimmed, attributes: { species, external: true, sex } })
}

/** The individuals split out of a group — a herd's named-and-tracked members. */
export async function childAssets(parentId: string): Promise<Asset[]> {
  const pg = await db()
  const { rows } = await pg.query<Asset>(
    `select id, type, name, status, terminal_event, parent_id, attributes
       from asset
      where parent_id = $1 and deleted_at is null`,
    [parentId],
  )
  return sortByStatusThenName(rows)
}

/** Every animal on record naming this one as its sire or dam. */
export async function offspringOf(assetId: string): Promise<Asset[]> {
  const pg = await db()
  const { rows } = await pg.query<Asset>(
    `select id, type, name, status, terminal_event, parent_id, attributes
       from asset
      where type = 'animal' and deleted_at is null
        and (attributes->>'sireId' = $1 or attributes->>'damId' = $1)`,
    [assetId],
  )
  return sortByStatusThenName(rows)
}

/** One asset by id — used to resolve a sire/dam reference to its own record. */
export async function getAsset(id: string): Promise<Asset | null> {
  const pg = await db()
  const { rows } = await pg.query<Asset>(
    `select id, type, name, status, terminal_event, parent_id, attributes
       from asset
      where id = $1 and deleted_at is null`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * A roster plus one real animal record per head, not a bare headcount. "5
 * head" has no individual for a weight chart or a vet bill to point at —
 * this is the same shape createAsset + SplitForm build one at a time in the
 * UI, done N times up front so a count of 5 means 5 actual animals, not a
 * number someone has to peel apart later.
 */
export async function createGroupWithMembers(input: {
  name: string
  count: number
  attributes?: Record<string, unknown>
}): Promise<string> {
  const pg = await db()
  const farm = await getFarmId()
  const groupId = await createAsset({
    type: 'group', name: input.name, attributes: input.attributes ?? {},
  })

  // One statement rather than one per head: a 500-bird flock was 500
  // sequential round-trips behind a disabled button, each re-reading the
  // farm id and firing its own outbox trigger. Chunked because every row
  // costs seven bind parameters and drivers cap how many a statement takes.
  const attrs = JSON.stringify(input.attributes ?? {})
  const now = new Date().toISOString()
  const CHUNK = 200
  for (let start = 1; start <= input.count; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, input.count)
    const values: unknown[] = []
    const tuples: string[] = []
    for (let i = start; i <= end; i++) {
      const b = values.length
      tuples.push(
        `($${b + 1}, $${b + 2}, 'animal', $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`,
      )
      values.push(crypto.randomUUID(), farm, `${input.name} ${i}`, attrs, groupId, now, now)
    }
    await pg.query(
      `insert into asset (id, farm_id, type, name, attributes, parent_id, created_at, updated_at)
       values ${tuples.join(', ')}`,
      values,
    )
  }
  return groupId
}

/**
 * Archiving a group archives the individuals under it too.
 *
 * Since a group carries one real animal per head, leaving the members
 * active when the flock is sold would keep them feeding tilesFor() forever
 * — an Eggs button for birds that are gone — while being unreachable from
 * the Stock list, which hides anything with a parent_id. Members that were
 * already closed out on their own keep the terminal_event they were given,
 * so a bird that died in June does not get relabelled "sold" in October.
 */
export async function archiveAsset(id: string, terminal: string) {
  const pg = await db()
  const now = new Date().toISOString()
  await pg.query(
    `update asset set status = 'archived', terminal_event = $2,
            updated_at = $3 where id = $1`,
    [id, terminal, now],
  )
  await pg.query(
    `update asset set status = 'archived', terminal_event = $2,
            updated_at = $3
      where parent_id = $1 and deleted_at is null and status = 'active'`,
    [id, terminal, now],
  )
}

/** One log, its assets and its quantities, written together. */
export async function createLog(input: {
  type: string
  name?: string
  notes?: string
  timestamp?: Date
  status?: 'planned' | 'done'
  assets?: { id: string; role?: AssetRole; amount?: number; unit?: string }[]
  quantities?: QuantityInput[]
}): Promise<string> {
  const pg = await db()
  const farm = await getFarmId()
  const logId = crypto.randomUUID()
  const now = new Date().toISOString()

  await pg.query(
    `insert into log (id, farm_id, type, timestamp, status, name, notes, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      logId,
      farm,
      input.type,
      (input.timestamp ?? new Date()).toISOString(),
      input.status ?? 'done',
      input.name ?? null,
      input.notes ?? null,
      now,
      now,
    ],
  )

  for (const a of input.assets ?? []) {
    await pg.query(
      `insert into log_asset (log_id, asset_id, role, amount, unit)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [logId, a.id, a.role ?? 'subject', a.amount ?? null, a.unit ?? null],
    )
  }
  for (const q of input.quantities ?? []) {
    await pg.query(
      `insert into quantity (id, farm_id, log_id, measure, value, unit, label, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [crypto.randomUUID(), farm, logId, q.measure, q.value, q.unit, q.label ?? null, now, now],
    )
  }
  return logId
}

/**
 * Recent activity, with subjects and quantities rolled into text.
 *
 * Weight is left out: a weigh-in isn't really "activity" the way a
 * purchase, harvest, or vet visit is — it's a routine measurement, and one
 * animal weighed weekly would drown out everything else here. It already
 * has its own place to live, the Growth chart on that animal's own profile
 * (still fully editable there, or from that same page's own History).
 */
export async function recentLogs(limit = 50): Promise<LogWithDetail[]> {
  const pg = await db()
  const { rows } = await pg.query<LogWithDetail>(
    `select l.id, l.type, l.timestamp, l.status, l.name, l.notes,
            (select group_concat(a.name, ', ' order by a.name)
               from log_asset la join asset a on a.id = la.asset_id
              where la.log_id = l.id and la.role = 'subject') as subjects,
            (select group_concat(printf('%.10g', q.value) || ' ' || q.unit, ', ')
               from quantity q where q.log_id = l.id
                 and q.deleted_at is null) as summary
       from log l
      where l.deleted_at is null and l.status <> 'planned' and l.type <> 'weight'
      order by l.timestamp desc, l.created_at desc
      limit $1`,
    [limit],
  )
  return rows
}

export async function assetCounts(): Promise<Record<string, number>> {
  const pg = await db()
  const { rows } = await pg.query<{ type: string; n: number }>(
    `select type, count(*) as n from asset
      where deleted_at is null and status = 'active'
      group by type`,
  )
  return Object.fromEntries(rows.map((r) => [r.type, r.n]))
}

// --------------------------------------------------------------- purchases

/**
 * A bought lot and the purchase log that records what it cost.
 *
 * `origin: 'service'` marks a lot that exists only to carry a price — a
 * vet visit, an oil change. It is spent the moment it is recorded, so it
 * is kept out of Stores, which is a list of what is on hand; without the
 * flag every such charge would pile up there under "Used up" forever.
 */
export async function createPurchase(input: {
  material: string
  name: string
  amount?: number
  unit?: string
  cost?: number
  supplier?: string
  origin?: 'purchased' | 'service'
}): Promise<string> {
  const lotId = await createAsset({
    type: 'lot',
    name: input.name,
    attributes: {
      origin: input.origin ?? 'purchased',
      material: input.material,
      ...(input.supplier ? { supplier: input.supplier } : {}),
    },
  })

  const quantities: QuantityInput[] = []
  // Not `input.cost && input.cost > 0` — a genuine $0 (free stock, a
  // no-charge recheck) is a real cost figure, not the absence of one.
  if (input.cost != null && input.cost >= 0)
    quantities.push({ measure: 'price', value: input.cost, unit: 'USD' })
  if (input.amount && input.amount > 0)
    quantities.push({ measure: 'weight', value: input.amount, unit: input.unit ?? 'lb' })

  await createLog({
    type: 'purchase',
    // A service (a vet visit, an oil change) was paid for, not bought — you
    // didn't buy the butcher.
    name: input.origin === 'service' ? `Paid for ${input.name}` : `Bought ${input.name}`,
    assets: [{ id: lotId, role: 'subject' }],
    quantities,
  })
  return lotId
}

// ---------------------------------------------------------------- harvest

/**
 * A harvest turns something the farm keeps into product it holds.
 *
 * Most harvests do NOT end their source: a cow is milked daily, a hive gives
 * honey every season, a bed of lettuce is cut repeatedly. Only slaughter and
 * pulling a crop finish the thing off, so `endsSource` must be asked for
 * rather than assumed — an earlier version archived unconditionally and
 * silently retired every dairy cow and beehive on first harvest.
 */
export async function createHarvest(input: {
  sourceId: string
  outputName: string
  material: string
  amount: number
  unit?: string
  endsSource?: boolean
}): Promise<string> {
  const pg = await db()
  const farm = await getFarmId()

  const outId = await createAsset({
    type: 'lot',
    name: input.outputName,
    attributes: { origin: 'produced', material: input.material },
  })
  const logId = await createLog({
    type: 'harvest',
    name: input.outputName,
    assets: [
      { id: input.sourceId, role: 'subject' },
      { id: outId, role: 'output' },
    ],
  })
  await pg.query(
    `insert into quantity (farm_id, log_id, measure, value, unit, asset_id)
     values ($1, $2, 'weight', $3, $4, $5)`,
    [farm, logId, input.amount, input.unit ?? 'lb', outId],
  )
  if (input.endsSource) await archiveAsset(input.sourceId, 'harvested')
  return outId
}

/**
 * A crop in a place for a season.
 *
 * Logging a seeding event assumes the planting happened today, which is
 * right when someone is recording it as it happens but wrong when they are
 * just describing an existing farm — setup has no idea when six-week-old
 * tomatoes actually went in. `logPlanting: false` skips the event without
 * skipping the planting itself.
 */
export async function createPlanting(input: {
  name: string
  crop: string
  variety?: string
  where?: string
  planted?: Date
  logPlanting?: boolean
}): Promise<string> {
  const id = await createAsset({
    type: 'planting',
    name: input.name,
    attributes: {
      crop: input.crop,
      ...(input.variety ? { variety: input.variety } : {}),
      ...(input.where ? { where: input.where } : {}),
    },
  })
  if (input.logPlanting ?? true) {
    await createLog({
      type: 'seeding',
      name: `Planted ${input.name}`,
      timestamp: input.planted ?? new Date(),
      assets: [{ id, role: 'subject' }],
    })
  }
  return id
}

// ------------------------------------------------------------ asset detail

export interface AssetEvent {
  id: string
  type: string
  timestamp: string
  name: string | null
  notes: string | null
  role: string
  summary: string | null
}

export async function logsForAsset(assetId: string): Promise<AssetEvent[]> {
  const pg = await db()
  const { rows } = await pg.query<AssetEvent>(
    `select l.id, l.type, l.timestamp, l.name, l.notes, la.role,
            (select group_concat(printf('%.10g', q.value) || ' ' || q.unit, ', ')
               from quantity q
              where q.log_id = l.id and q.deleted_at is null) as summary
       from log_asset la
       join log l on l.id = la.log_id
      where la.asset_id = $1 and l.deleted_at is null
      order by l.timestamp desc`,
    [assetId],
  )
  return rows
}

export interface CostSummary {
  purchaseCost: number
  inputCost: number
  outputs: { name: string; amount: number | null; unit: string | null }[]
  outputAmount: number
  costPerUnit: number | null
  unit: string | null
}

/**
 * What went in, what came out, and the cost per unit of output.
 *
 * Feed is prorated: if a feeding recorded how much of a lot it used, only
 * that share of the lot's purchase price is charged. If no amount was
 * recorded, the lot's whole cost is charged once, not once per feeding.
 *
 * `purchaseCost` is separate from `inputCost` on purpose: what an animal
 * cost to buy and what it cost to keep are different questions, and lumping
 * them would make "$340 in feed" and "$340 to buy plus feed" look the same
 * on screen. Both still add into cost-per-unit — an animal bought outright
 * is not free just because nothing was purchased *for* it afterward.
 */
export async function assetCosts(assetId: string): Promise<CostSummary> {
  const pg = await db()

  const purchase = await pg.query<{ purchase_cost: number }>(
    `select coalesce(sum(q.value), 0) as purchase_cost
       from log_asset la
       join log p on p.id = la.log_id
            and p.type = 'purchase' and p.deleted_at is null
       join quantity q on q.log_id = p.id
            and q.deleted_at is null and q.measure = 'price'
      where la.asset_id = $1 and la.role = 'subject'`,
    [assetId],
  )

  const cost = await pg.query<{ input_cost: number }>(
    `with used as (
       select la_in.asset_id as lot_id, la_in.amount as used_amount
         from log_asset subj
         join log l on l.id = subj.log_id
              and l.type = 'input_application' and l.deleted_at is null
         join log_asset la_in on la_in.log_id = l.id and la_in.role = 'input'
        where subj.asset_id = $1 and subj.role = 'subject'
     ),
     per_lot as (
       select lot_id, sum(used_amount) as used_total,
              -- bool_or() doesn't exist in SQLite; max() over the 0/1 that
              -- an "is null" check already evaluates to is the same thing.
              max(used_amount is null) as unknown_amount
         from used group by lot_id
     ),
     lot_purchase as (
       select la.asset_id as lot_id,
              max(q.value) filter (where q.measure = 'price')  as price,
              max(q.value) filter (where q.measure = 'weight') as bought
         from log_asset la
         join log p on p.id = la.log_id
              and p.type = 'purchase' and p.deleted_at is null
         join quantity q on q.log_id = p.id and q.deleted_at is null
        where la.role = 'subject'
        group by la.asset_id
     )
     select coalesce(sum(
       case
         when lp.price is null then 0
         when pl.unknown_amount then lp.price
         when lp.bought > 0
           -- least() doesn't exist in SQLite; min() with 2+ plain arguments
           -- (not the aggregate form) is the same thing. used_total is never
           -- null on this branch (unknown_amount above is false), so this
           -- doesn't hit the one case where SQLite's min() and Postgres's
           -- least() disagree — least() ignores a null argument, min() does not.
           then lp.price * min(pl.used_total / lp.bought, 1)
         else lp.price
       end), 0) as input_cost
       from per_lot pl join lot_purchase lp on lp.lot_id = pl.lot_id`,
    [assetId],
  )

  const outs = await pg.query<{ name: string; amount: number | null; unit: string | null }>(
    `select a.name,
            q.value as amount,
            q.unit
       from log_asset subj
       join log h on h.id = subj.log_id
            and h.type = 'harvest' and h.deleted_at is null
       join log_asset outp on outp.log_id = h.id and outp.role = 'output'
       join asset a on a.id = outp.asset_id
       left join quantity q on q.log_id = h.id
            and q.asset_id = outp.asset_id and q.measure = 'weight'
      where subj.asset_id = $1 and subj.role = 'subject'`,
    [assetId],
  )

  const purchaseCost = purchase.rows[0]?.purchase_cost ?? 0
  const inputCost = cost.rows[0]?.input_cost ?? 0
  const outputs = outs.rows
  const outputAmount = outputs.reduce((s, o) => s + (o.amount ?? 0), 0)
  const unit = outputs.find((o) => o.unit)?.unit ?? null

  return {
    purchaseCost,
    inputCost,
    outputs,
    outputAmount,
    unit,
    costPerUnit: outputAmount > 0 ? (purchaseCost + inputCost) / outputAmount : null,
  }
}

export interface CostEntry { timestamp: string; value: number; material: string }

/**
 * Every dollar the farm has spent, flat — the raw material for the
 * Analytics page. Bucketing by week/month/quarter/year happens in the
 * browser (see lib/periods.ts), not here: that math depends on the
 * viewer's local calendar, and a purchase's timestamp is the only fact
 * this needs to hand over.
 */
export async function costEntries(): Promise<CostEntry[]> {
  const pg = await db()
  const { rows } = await pg.query<CostEntry>(
    // A lot (hay, feed, parts) carries its own material. An animal or
    // group has none — species is the closest thing it has to one, so a
    // bought cow lands under "Cattle" rather than a catch-all. Equipment
    // has neither, but 'kind' (Tractor/Vehicle/...) plays the same role, so
    // a tractor purchase doesn't drown out everything else under "Other".
    `select l.timestamp, q.value as value,
            coalesce(a.attributes->>'material', a.attributes->>'species',
                     a.attributes->>'kind', 'Other') as material
       from log l
       join quantity q on q.log_id = l.id and q.deleted_at is null
            and q.measure = 'price'
       left join log_asset la on la.log_id = l.id and la.role = 'subject'
       left join asset a on a.id = la.asset_id
      where l.type = 'purchase' and l.deleted_at is null
      order by l.timestamp asc`,
  )
  return rows
}

/** A weight's history for an asset, oldest first — the raw material for a growth chart. */
export async function weightHistory(assetId: string): Promise<
  { timestamp: string; value: number; unit: string }[]
> {
  const pg = await db()
  const { rows } = await pg.query<{ timestamp: string; value: number; unit: string }>(
    `select l.timestamp, q.value as value, q.unit
       from log l
       join log_asset la on la.log_id = l.id
            and la.asset_id = $1 and la.role = 'subject'
       join quantity q on q.log_id = l.id
            and q.measure = 'weight' and q.deleted_at is null
      where l.type = 'weight' and l.deleted_at is null
      order by l.timestamp asc`,
    [assetId],
  )
  return rows
}

// ------------------------------------------------------------ farm identity

export async function getFarmName(): Promise<string> {
  const pg = await db()
  const { rows } = await pg.query<{ name: string }>(`select name from farm limit 1`)
  return rows[0]?.name ?? 'My farm'
}

export async function localIsEmpty(): Promise<boolean> {
  const pg = await db()
  const { rows } = await pg.query<{ n: number }>(
    `select ((select count(*) from asset) +
             (select count(*) from log) +
             (select count(*) from location)) as n`,
  )
  return (rows[0]?.n ?? 0) === 0
}

/**
 * Point the local database at an existing remote farm. Only safe while there
 * is no local data, since farm_id is stamped on every row; returns false and
 * changes nothing otherwise, leaving the conflict for the sync work to solve.
 */
export async function adoptFarmId(id: string, name: string): Promise<boolean> {
  if (!(await localIsEmpty())) return false
  const pg = await db()
  const now = new Date().toISOString()
  await pg.exec(`delete from farm`)
  await pg.query(
    `insert into farm (id, name, created_at, updated_at) values ($1, $2, $3, $4)`,
    [id, name, now, now],
  )
  farmId = null
  return true
}

export async function renameFarm(name: string) {
  const pg = await db()
  await pg.query(`update farm set name = $1, updated_at = $2`, [name, new Date().toISOString()])
}

// ----------------------------------------------------------- edit & delete

export async function updateAsset(id: string, input: {
  name?: string
  attributes?: Record<string, unknown>
}) {
  const pg = await db()
  const now = new Date().toISOString()
  if (input.name !== undefined) {
    await pg.query(
      `update asset set name = $2, updated_at = $3 where id = $1`,
      [id, input.name, now],
    )
  }
  if (input.attributes !== undefined) {
    await pg.query(
      `update asset set attributes = $2, updated_at = $3 where id = $1`,
      [id, JSON.stringify(input.attributes), now],
    )
  }
}

export async function updateLog(id: string, input: {
  name?: string | null
  notes?: string | null
  timestamp?: Date
}) {
  const pg = await db()
  const sets: string[] = []
  const vals: unknown[] = [id]
  if (input.name !== undefined) { sets.push(`name = $${vals.push(input.name)}`) }
  if (input.notes !== undefined) { sets.push(`notes = $${vals.push(input.notes)}`) }
  if (input.timestamp !== undefined) {
    sets.push(`timestamp = $${vals.push(input.timestamp.toISOString())}`)
  }
  if (sets.length === 0) return
  const updatedAtParam = vals.push(new Date().toISOString())
  await pg.query(
    `update log set ${sets.join(', ')}, updated_at = $${updatedAtParam} where id = $1`, vals,
  )
}

export async function setQuantity(logId: string, measure: Measure, value: number) {
  const pg = await db()
  const { rows } = await pg.query<{ id: string }>(
    `select id from quantity
      where log_id = $1 and measure = $2 and deleted_at is null limit 1`,
    [logId, measure],
  )
  if (rows[0]) {
    await pg.query(
      `update quantity set value = $2, updated_at = $3 where id = $1`,
      [rows[0].id, value, new Date().toISOString()],
    )
  }
}

export async function quantitiesFor(logId: string) {
  const pg = await db()
  const { rows } = await pg.query<{
    id: string; measure: Measure; value: number; unit: string; label: string | null
  }>(
    `select id, measure, value, unit, label
       from quantity where log_id = $1 and deleted_at is null order by measure`,
    [logId],
  )
  return rows
}

/**
 * Soft delete. Rows are never removed: a device that has been offline must be
 * told a record died rather than simply find it missing, and the deleted_at
 * update is what syncs that fact.
 *
 * A purchase log is the only thing that brings its lot into existence, so
 * deleting one that nothing else has touched (no other purchase, feeding, or
 * disposition logged against that lot) takes the lot down with it too —
 * otherwise "delete this duplicate purchase" leaves a phantom, zero-balance
 * lot still selectable everywhere lots are picked from (Feed, Vet/Med,
 * Stores), which is exactly the record it looked like this had just deleted.
 */
export async function deleteLog(id: string) {
  const pg = await db()
  const now = new Date().toISOString()
  const { rows: logRows } = await pg.query<{ type: string }>(
    `select type from log where id = $1`, [id],
  )

  await pg.query(
    `update log set deleted_at = $2, updated_at = $2 where id = $1`, [id, now],
  )
  await pg.query(
    `update quantity set deleted_at = $2, updated_at = $2
      where log_id = $1 and deleted_at is null`, [id, now],
  )

  if (logRows[0]?.type === 'purchase') {
    const { rows: subjects } = await pg.query<{ asset_id: string }>(
      `select asset_id from log_asset where log_id = $1 and role = 'subject'`, [id],
    )
    for (const { asset_id } of subjects) {
      const { rows: untouched } = await pg.query<{ n: number }>(
        `select count(*) as n
           from log_asset la
           join log l on l.id = la.log_id and l.deleted_at is null
          where la.asset_id = $1`, [asset_id],
      )
      if (untouched[0].n === 0) {
        await pg.query(
          `update asset set deleted_at = $2, updated_at = $2
            where id = $1 and type = 'lot'`, [asset_id, now],
        )
      }
    }
  }
}

export async function deleteAsset(id: string) {
  const pg = await db()
  const now = new Date().toISOString()
  await pg.query(
    `update asset set deleted_at = $2, updated_at = $2 where id = $1`, [id, now],
  )
}

// -------------------------------------------------------------- inventory

export interface LotBalance {
  id: string
  name: string
  material: string | null
  origin: string | null
  came_in: number
  went_out: number
  remaining: number
  unit: string | null
}

/**
 * What is left of each lot.
 *
 * In: what a purchase brought, or what a harvest or processing produced.
 * Out: what dispositions took (freezer withdrawals, sales, gifts) plus what
 * other logs consumed of it — feed applied to a flock, tomatoes canned into
 * sauce. The consumed amount lives on log_asset, not on a quantity, because
 * it describes how much of *that lot* a log used.
 */
export async function lotBalances(): Promise<LotBalance[]> {
  const pg = await db()
  const { rows } = await pg.query<LotBalance>(
    `with came as (
       select la.asset_id as lot_id,
              sum(q.value) as amount,
              max(q.unit) as unit
         from log_asset la
         join log l on l.id = la.log_id and l.deleted_at is null
         join quantity q on q.log_id = l.id and q.deleted_at is null
              and q.measure in ('weight','count','volume')
        where (l.type = 'purchase' and la.role = 'subject')
           or (l.type in ('harvest','processing') and la.role = 'output')
        group by la.asset_id
     ),
     taken as (
       select la.asset_id as lot_id, sum(q.value) as amount
         from log_asset la
         join log l on l.id = la.log_id and l.deleted_at is null
              and l.type = 'disposition' and la.role = 'subject'
         join quantity q on q.log_id = l.id and q.deleted_at is null
              and q.measure in ('weight','count','volume')
        group by la.asset_id
     ),
     consumed as (
       select la.asset_id as lot_id, sum(la.amount) as amount
         from log_asset la
         join log l on l.id = la.log_id and l.deleted_at is null
        where la.role = 'input' and la.amount is not null
        group by la.asset_id
     )
     select a.id, a.name,
            a.attributes->>'material' as material,
            a.attributes->>'origin'   as origin,
            coalesce(c.amount, 0)                                as came_in,
            coalesce(t.amount, 0) + coalesce(u.amount, 0)        as went_out,
            coalesce(c.amount, 0) - coalesce(t.amount, 0)
              - coalesce(u.amount, 0)                            as remaining,
            c.unit
       from asset a
       left join came     c on c.lot_id = a.id
       left join taken    t on t.lot_id = a.id
       left join consumed u on u.lot_id = a.id
      where a.type = 'lot' and a.deleted_at is null
        and coalesce(a.attributes->>'origin', '') <> 'service'
      order by (coalesce(c.amount,0) - coalesce(t.amount,0)
                - coalesce(u.amount,0)) > 0 desc, a.name`,
  )
  return rows
}

export async function lotBalance(id: string): Promise<LotBalance | null> {
  const all = await lotBalances()
  return all.find((l) => l.id === id) ?? null
}

/** Take from a lot: eaten at home, sold, given away, fed back, or lost. */
export async function recordDisposition(input: {
  lotId: string
  kind: 'home_use' | 'sold' | 'given' | 'traded' | 'lost' | 'fed_back'
  amount: number
  unit?: string
  value?: number
  notes?: string
}): Promise<string> {
  const quantities: QuantityInput[] = [
    { measure: 'weight', value: input.amount, unit: input.unit ?? 'lb' },
  ]
  if (input.value && input.value > 0) {
    quantities.push({ measure: 'price', value: input.value, unit: 'USD' })
  }
  return createLog({
    type: 'disposition',
    name: LABEL[input.kind],
    notes: input.notes,
    assets: [{ id: input.lotId, role: 'subject' }],
    quantities,
  })
}

const LABEL: Record<string, string> = {
  home_use: 'Used at home',
  sold: 'Sold',
  given: 'Given away',
  traded: 'Traded',
  lost: 'Lost or spoiled',
  fed_back: 'Fed to livestock',
}

// ------------------------------------------------------------------ tasks

/** Things not done yet, soonest first. Overdue sorts to the top naturally. */
export async function plannedLogs(): Promise<LogWithDetail[]> {
  const pg = await db()
  const { rows } = await pg.query<LogWithDetail>(
    `select l.id, l.type, l.timestamp, l.status, l.name, l.notes,
            (select group_concat(a.name, ', ' order by a.name)
               from log_asset la join asset a on a.id = la.asset_id
              where la.log_id = l.id and la.role = 'subject') as subjects,
            null as summary
       from log l
      where l.deleted_at is null and l.status = 'planned'
      order by l.timestamp asc`,
  )
  return rows
}

export async function planTask(input: {
  name: string
  due: Date
  notes?: string
  assetId?: string
  type?: string
}): Promise<string> {
  return createLog({
    type: input.type ?? 'activity',
    name: input.name,
    notes: input.notes,
    timestamp: input.due,
    status: 'planned',
    assets: input.assetId ? [{ id: input.assetId, role: 'subject' }] : [],
  })
}

/**
 * Mark a task done. The timestamp moves to now rather than staying on the
 * date it was planned for, because the history should record when the work
 * actually happened.
 */
export async function completeTask(id: string) {
  const pg = await db()
  const now = new Date().toISOString()
  await pg.query(
    `update log set status = 'done', timestamp = $2, updated_at = $2
      where id = $1`, [id, now],
  )
}

export async function cancelTask(id: string) {
  const pg = await db()
  await pg.query(
    `update log set status = 'cancelled', updated_at = $2 where id = $1`,
    [id, new Date().toISOString()],
  )
}
