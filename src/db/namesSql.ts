// The reads and writes behind consistent names — the Buy sheet's
// suggestions and Settings' "Tidy up names" — kept in a file with no
// imports so db/test/verify-name-merge.ts runs these exact statements under
// node:sqlite. queries.ts can't be loaded there (it talks to the browser's
// database worker). verify-query-scope holds this file to the same rule.

/**
 * What can be tidied: the store a purchase came from, the name a bought
 * thing goes by (what Stores and the Feed picker list), and its kind.
 */
export type NameKind = 'store' | 'item' | 'kind'

/**
 * Bought things only — produced lots (eggs, milk) are named by the farm.
 * The farm itself is scoped in each statement below, written out so
 * verify-query-scope can see it.
 */
const BOUGHT = `a.type = 'lot' and a.deleted_at is null
     and coalesce(a.attributes->>'origin', 'purchased') in ('purchased', 'service')`

/** Each name in use, and how many purchases use it. */
export const NAME_USAGE_SQL: Record<NameKind, string> = {
  store: `
    select trim(a.attributes->>'supplier') as name, count(*) as count
      from asset a
     where a.farm_id = (select id from active_farm) and ${BOUGHT}
       and trim(coalesce(a.attributes->>'supplier', '')) <> ''
     group by trim(a.attributes->>'supplier')`,
  item: `
    select a.name, count(*) as count
      from asset a
     where a.farm_id = (select id from active_farm) and ${BOUGHT}
     group by a.name`,
  kind: `
    select a.attributes->>'material' as name, count(*) as count
      from asset a
     where a.farm_id = (select id from active_farm) and ${BOUGHT}
       and a.attributes->>'material' is not null
     group by a.attributes->>'material'`,
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

/**
 * Renames every use of one name to another ($1 = from, $2 = into). Each
 * list is run in order, all with the same two parameters.
 *
 * An item's purchase logs are renamed with it — "Bought Hog feed" becomes
 * "Bought Pig feed" — so Records reads the same as Stores. A kind's
 * farm-made term is retired once nothing uses it, so it stops being
 * offered; a kind the app ships with is left in the list.
 *
 * Every row touched gets a fresh updated_at, which is what queues it for
 * sync to the other devices on the account.
 */
export const MERGE_NAME_SQL: Record<NameKind, string[]> = {
  store: [`
    update asset
       set attributes = json_set(attributes, '$.supplier', $2), updated_at = ${NOW}
     where id in (select a.id from asset a
                   where a.farm_id = (select id from active_farm) and ${BOUGHT}
                     and trim(a.attributes->>'supplier') = $1)`],
  item: [`
    update log
       set name = (case when name like 'Paid for %' then 'Paid for ' else 'Bought ' end) || $2,
           updated_at = ${NOW}
     where farm_id = (select id from active_farm)
       and type = 'purchase' and deleted_at is null
       and name in ('Bought ' || $1, 'Paid for ' || $1)`, `
    update asset
       set name = $2, updated_at = ${NOW}
     where id in (select a.id from asset a
                   where a.farm_id = (select id from active_farm) and ${BOUGHT}
                     and a.name = $1)`],
  kind: [`
    update asset
       set attributes = json_set(attributes, '$.material', $2), updated_at = ${NOW}
     where id in (select a.id from asset a
                   where a.farm_id = (select id from active_farm) and ${BOUGHT}
                     and a.attributes->>'material' = $1)`, `
    update term
       set deleted_at = ${NOW}, updated_at = ${NOW}
     where vocabulary = 'material' and name = $1 and deleted_at is null
       and farm_id = (select id from active_farm)`],
}
