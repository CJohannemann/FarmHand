// One-off data fixes the worker's migrate() runs once per device, in plain
// SQLite. Kept out of saleCostSql.ts and queries.ts on purpose: those are
// the app's reads of one farm and are held to verify-query-scope's rule,
// whereas a fix like this is meant for every farm on the device. No imports,
// so db/test can run the exact statements.

/**
 * A sale's "processing fee" was briefly money the buyer paid the farm, and
 * was added into the sale's price. It is now the butcher's bill, which the
 * buyer pays the butcher: kept beside the sale for quoting the next
 * customer, never counted as the farm's income. These turn a sale saved the
 * old way into the new shape — the fee taken back out of its price and
 * moved to butcher_cost — so its profit stops counting the butcher's money.
 *
 * Every farm on the device, not just the active one. Run once per device
 * by the worker's migrate(). Safe to re-run:
 * both only touch sales still carrying processing_fee, and the second
 * statement removes it. The price is fixed first, while the fee it
 * subtracts is still there to read.
 */
export const BUTCHER_COST_MIGRATION_SQL = [
  `update quantity
      set value = round(value - (select json_extract(l.attributes, '$.processing_fee')
                                   from log l where l.id = quantity.log_id), 2),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    where measure = 'price' and deleted_at is null
      and log_id in (select id from log
                      where type = 'sale'
                        and json_extract(attributes, '$.processing_fee') is not null)`,
  `update log
      set attributes = json_set(json_remove(attributes, '$.processing_fee'),
                                '$.butcher_cost', json_extract(attributes, '$.processing_fee')),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    where type = 'sale' and json_extract(attributes, '$.processing_fee') is not null`,
]
