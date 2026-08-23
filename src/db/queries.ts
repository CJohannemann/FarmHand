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
  assets?: { id: string; role?: AssetRole }[]
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
      `insert into log_asset (log_id, asset_id, role) values ($1, $2, $3)
       on conflict do nothing`,
      [logId, a.id, a.role ?? 'subject'],
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
