/**
 * Postgres handed `jsonb` columns back as parsed objects; SQLite has no JSON
 * type and hands the same columns back as plain TEXT. Every caller was
 * written against the Postgres behaviour — `asset.attributes?.species`,
 * `{ ...asset.attributes }`, `delete attributes.headcount` — and a string
 * silently satisfies none of it: property reads come back `undefined`, and
 * spreading one yields a character-indexed object rather than the fields.
 * That is why species, headcount, ear tags and equipment details all read as
 * blank after the storage-engine migration, and why tilesFor() stopped
 * recognising a laying flock or a dairy herd.
 *
 * It also mattered on the way out: push() reads rows through this same path
 * and hands them to PostgREST, so an un-parsed string was written into the
 * remote `jsonb` column as a JSON *string* — `"{\"species\":\"Pig\"}"` —
 * rather than an object. Parsing here fixes both directions at once.
 */
const JSON_COLUMNS = ['attributes', 'geometry'] as const

/**
 * Mutates and returns the rows — they are fresh structured-clone copies
 * coming off a postMessage, so nothing else holds a reference to them.
 *
 * Deliberately tolerant: a value that is already an object (or null, or
 * absent) is left alone, and text that does not parse is left as-is rather
 * than throwing. A malformed attributes blob should render as nothing much,
 * not take down the whole screen that reads it.
 */
export function parseJsonColumns<T>(rows: T[]): T[] {
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue
    for (const col of JSON_COLUMNS) {
      const value = row[col]
      if (typeof value !== 'string') continue
      try {
        row[col] = JSON.parse(value)
      } catch {
        // Leave the raw text in place; see the tolerance note above.
      }
    }
  }
  return rows
}
