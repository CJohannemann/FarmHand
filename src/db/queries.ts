import { db } from './client'
import type { Asset, AssetRole, AssetType, LogWithDetail, QuantityInput } from './types'

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

export async function listAssets(types?: AssetType[]): Promise<Asset[]> {
  const pg = await db()
  const { rows } = await pg.query<Asset>(
    `select id, type, name, status, terminal_event, parent_id, attributes
       from asset
      where deleted_at is null
        and ($1::text[] is null or type = any($1::text[]))
      order by status, name`,
    [types ?? null],
  )
  return rows
}

export async function createAsset(input: {
  type: AssetType
  name: string
  attributes?: Record<string, unknown>
}): Promise<string> {
  const pg = await db()
  const farm = await getFarmId()
  const { rows } = await pg.query<{ id: string }>(
    `insert into asset (farm_id, type, name, attributes)
     values ($1, $2, $3, $4) returning id`,
    [farm, input.type, input.name, JSON.stringify(input.attributes ?? {})],
  )
  return rows[0].id
}

export async function archiveAsset(id: string, terminal: string) {
  const pg = await db()
  await pg.query(
    `update asset set status = 'archived', terminal_event = $2,
            updated_at = now() where id = $1`,
    [id, terminal],
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

  const { rows } = await pg.query<{ id: string }>(
    `insert into log (farm_id, type, timestamp, status, name, notes)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      farm,
      input.type,
      (input.timestamp ?? new Date()).toISOString(),
      input.status ?? 'done',
      input.name ?? null,
      input.notes ?? null,
    ],
  )
  const logId = rows[0].id

  for (const a of input.assets ?? []) {
    await pg.query(
      `insert into log_asset (log_id, asset_id, role, amount, unit)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [logId, a.id, a.role ?? 'subject', a.amount ?? null, a.unit ?? null],
    )
  }
  for (const q of input.quantities ?? []) {
    await pg.query(
      `insert into quantity (farm_id, log_id, measure, value, unit, label)
       values ($1, $2, $3, $4, $5, $6)`,
      [farm, logId, q.measure, q.value, q.unit, q.label ?? null],
    )
  }
  return logId
}

/** Recent activity, with subjects and quantities rolled into text. */
export async function recentLogs(limit = 50): Promise<LogWithDetail[]> {
  const pg = await db()
  const { rows } = await pg.query<LogWithDetail>(
    `select l.id, l.type, l.timestamp, l.status, l.name, l.notes,
            (select string_agg(a.name, ', ' order by a.name)
               from log_asset la join asset a on a.id = la.asset_id
              where la.log_id = l.id and la.role = 'subject') as subjects,
            (select string_agg(q.value::text || ' ' || q.unit, ', ')
               from quantity q where q.log_id = l.id
                 and q.deleted_at is null) as summary
       from log l
      where l.deleted_at is null
      order by l.timestamp desc, l.created_at desc
      limit $1`,
    [limit],
  )
  return rows
}

export async function assetCounts(): Promise<Record<string, number>> {
  const pg = await db()
  const { rows } = await pg.query<{ type: string; n: number }>(
    `select type, count(*)::int as n from asset
      where deleted_at is null and status = 'active'
      group by type`,
  )
  return Object.fromEntries(rows.map((r) => [r.type, r.n]))
}

// --------------------------------------------------------------- purchases

/** A bought lot and the purchase log that records what it cost. */
export async function createPurchase(input: {
  material: string
  name: string
  amount?: number
  unit?: string
  cost?: number
  supplier?: string
}): Promise<string> {
  const lotId = await createAsset({
    type: 'lot',
    name: input.name,
    attributes: {
      origin: 'purchased',
      material: input.material,
      ...(input.supplier ? { supplier: input.supplier } : {}),
    },
  })

  const quantities: QuantityInput[] = []
  if (input.cost && input.cost > 0)
    quantities.push({ measure: 'price', value: input.cost, unit: 'USD' })
  if (input.amount && input.amount > 0)
    quantities.push({ measure: 'weight', value: input.amount, unit: input.unit ?? 'lb' })

  await createLog({
    type: 'purchase',
    name: `Bought ${input.name}`,
    assets: [{ id: lotId, role: 'subject' }],
    quantities,
  })
  return lotId
}

// ---------------------------------------------------------------- harvest

/** Slaughter or harvest: consumes an asset, produces a lot, archives source. */
export async function createHarvest(input: {
  sourceId: string
  outputName: string
  material: string
  amount: number
  unit?: string
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
  await archiveAsset(input.sourceId, 'harvested')
  return outId
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
            (select string_agg(q.value::text || ' ' || q.unit, ', ')
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
 */
export async function assetCosts(assetId: string): Promise<CostSummary> {
  const pg = await db()

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
              bool_or(used_amount is null) as unknown_amount
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
           then lp.price * least(pl.used_total / lp.bought, 1)
         else lp.price
       end), 0)::float as input_cost
       from per_lot pl join lot_purchase lp on lp.lot_id = pl.lot_id`,
    [assetId],
  )

  const outs = await pg.query<{ name: string; amount: number | null; unit: string | null }>(
    `select a.name,
            q.value::float as amount,
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

  const inputCost = cost.rows[0]?.input_cost ?? 0
  const outputs = outs.rows
  const outputAmount = outputs.reduce((s, o) => s + (o.amount ?? 0), 0)
  const unit = outputs.find((o) => o.unit)?.unit ?? null

  return {
    inputCost,
    outputs,
    outputAmount,
    unit,
    costPerUnit: outputAmount > 0 ? inputCost / outputAmount : null,
  }
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
             (select count(*) from location))::int as n`,
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
  await pg.exec(`delete from farm`)
  await pg.query(`insert into farm (id, name) values ($1, $2)`, [id, name])
  farmId = null
  return true
}

export async function renameFarm(name: string) {
  const pg = await db()
  await pg.query(`update farm set name = $1, updated_at = now()`, [name])
}
