// A farm-wide setting, stored as a farm-owned row in `term` — today just
// the receipt-scanning key (see lib/scanKey.ts). Kept in a file with no
// imports so db/test/verify-scan-key.ts runs these exact statements under
// node:sqlite; verify-query-scope holds this file to the same rule as
// queries.ts.
//
// Why `term` and not a new column on `farm`: sync copies rows column by
// column, so a new farm column breaks syncing for every phone still on an
// older version (and for the server, until its migration runs) — a
// key-shaped hole in a farm's sync. A farm-owned term already syncs to
// every member, is already fenced to that farm by row-level security
// (tenant_all on term), and needs no migration on either side. The value
// rides in `name`; the setting's name is the `vocabulary`.

/** The setting's current value: the newest live row, if any. $1 = setting. */
export const GET_SETTING_SQL = `
  select name as value from term
   where vocabulary = $1 and deleted_at is null
     and farm_id = (select id from active_farm)
   order by updated_at desc
   limit 1`

/**
 * Clearing a setting: every live row for it, soft-deleted so the deletion
 * syncs. Run before writing a new value too, so two people setting it at
 * once leave the newest standing rather than two rows. $1 = setting.
 */
export const CLEAR_SETTING_SQL = `
  update term
     set deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   where vocabulary = $1 and deleted_at is null
     and farm_id = (select id from active_farm)`

/** A new value. $1 id, $2 setting, $3 value, $4 now. */
export const SET_SETTING_SQL = `
  insert into term (id, farm_id, vocabulary, name, created_at, updated_at)
  values ($1, (select id from active_farm), $2, $3, $4, $4)`

/** The vocabulary the scanning key is kept under. */
export const SCAN_KEY_SETTING = 'setting:receipt-scan-key'
