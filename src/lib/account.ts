import { supabase } from './supabase'
import { describeError } from './supabase'
import { db } from '../db/client'
import { resetLocalData } from '../db/client'
import { getFarmName } from '../db/queries'
import { fetchReceiptData } from './receipts'
import { csvField, makeZip, safeFileName, base64ToBytes } from './zip'

/**
 * Taking your records with you, and leaving.
 *
 * The landing page promises "what you log is yours, and it stays yours",
 * which is only true if there is a door. These are that door: everything the
 * farm holds, in a form another program can read, and a way to delete the
 * account without asking whoever runs the server to do it by hand.
 */

/**
 * Every table that belongs to the farm, in the order a reader would want
 * them. sync_outbox/sync_state/sync_control are deliberately absent — they
 * are this device's bookkeeping about what it has pushed, not records of the
 * farm, and would only confuse someone opening the archive.
 */
const EXPORTED = [
  'farm', 'location', 'asset', 'log', 'log_asset', 'quantity', 'term', 'receipt',
] as const

export interface ExportProgress { label: string; done: number; total: number }

/**
 * The whole farm as a ZIP: CSV per table for anything that opens a
 * spreadsheet, one farm.json carrying every row and column exactly as
 * stored, and the receipt images.
 *
 * Both formats on purpose. CSV is what a person can actually use — open it,
 * sort it, hand it to an accountant — but it flattens JSON columns and loses
 * types. farm.json is the lossless copy: it is what you would need to
 * reconstruct this farm somewhere else, and it costs a few hundred kilobytes
 * next to the images.
 */
export async function exportEverything(
  onProgress?: (p: ExportProgress) => void,
): Promise<{ filename: string; bytes: Uint8Array; receipts: number; missing: number }> {
  const pg = await db()
  const enc = new TextEncoder()
  const entries: { name: string; data: Uint8Array }[] = []
  const everything: Record<string, unknown[]> = {}

  for (const [i, table] of EXPORTED.entries()) {
    onProgress?.({ label: `Reading ${table}`, done: i, total: EXPORTED.length + 1 })
    const { rows } = await pg.query<Record<string, unknown>>(`select * from "${table}"`)
    everything[table] = rows
    if (rows.length) entries.push({ name: `${table}.csv`, data: enc.encode(toCsv(rows)) })
  }

  // Receipt images, under a folder, named the way the per-year export names
  // them so the two archives are recognisably the same records.
  onProgress?.({ label: 'Fetching receipts', done: EXPORTED.length, total: EXPORTED.length + 1 })
  const receipts = (everything.receipt ?? []) as { id: string; deleted_at: string | null }[]
  let got = 0
  let missing = 0
  for (const r of receipts) {
    if (r.deleted_at) continue
    const data = await fetchReceiptData(r.id)
    if (!data) { missing++; continue }
    entries.push({ name: `receipts/${safeFileName(r.id)}.jpg`, data: base64ToBytes(data) })
    got++
  }

  entries.unshift({
    name: 'farm.json',
    data: enc.encode(JSON.stringify(
      { exported_at: new Date().toISOString(), tables: everything }, null, 2)),
  })
  entries.unshift({ name: 'README.txt', data: enc.encode(readme(receipts.length, got, missing)) })

  onProgress?.({ label: 'Building the archive', done: EXPORTED.length + 1, total: EXPORTED.length + 1 })
  const slug = safeFileName(await getFarmName(), 'farmhand')
  return {
    filename: `${slug}-everything-${new Date().toISOString().slice(0, 10)}.zip`,
    bytes: makeZip(entries),
    receipts: got,
    missing,
  }
}

/**
 * An archive of bare CSVs with no explanation is a pile of files, not a
 * record someone can use in five years when this app is a memory.
 */
function readme(total: number, got: number, missing: number): string {
  return [
    'Your farm, exported from Farm Hand Manager.',
    '',
    'farm.json    Every row and column exactly as stored. The lossless copy —',
    '             use this one if you ever need to rebuild the farm elsewhere.',
    '*.csv        The same records, one file per table, for spreadsheets.',
    '             JSON columns are flattened to text here.',
    'receipts/    Receipt photographs, named by their id. The `receipt` table',
    '             ties each one back to the purchase it documents.',
    '',
    'How the records fit together:',
    '  asset      the things the farm has — animals, groups, lots, equipment',
    '  log        the things that happened — purchases, harvests, treatments',
    '  log_asset  which assets each log was about',
    '  quantity   the numbers on a log — price, weight, count',
    '  term       vocabulary: species, breeds, materials, units',
    '  location   places on the farm',
    '',
    'Rows with a deleted_at are deleted; they are kept so that devices which',
    'were offline can be told a record died rather than just find it gone.',
    '',
    `Receipts: ${got} of ${total} images included.`,
    missing
      ? `${missing} could not be fetched — they are on the server but this ` +
        'device could not reach them. Try again with a connection.'
      : '',
  ].filter(Boolean).join('\n')
}

/** Union of every key across the rows, so a column that's null in row 1 still gets one. */
function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const lines = [cols.join(',')]
  for (const row of rows) {
    lines.push(cols.map((c) => {
      const v = row[c]
      // Objects only appear where a column holds JSON; stringify rather than
      // let one render as "[object Object]".
      return csvField(v !== null && typeof v === 'object' ? JSON.stringify(v) : v as string)
    }).join(','))
  }
  // CRLF and a BOM, so Excel opens it as UTF-8 rather than the local code page.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/**
 * Delete the signed-in account and, if they were the last person on it, the
 * farm and everything on it.
 *
 * The server refuses if the caller owns a farm other people are still using
 * — that message is written for a person and is shown as-is. See
 * migration 013 for why that case can't just be guessed at.
 */
export async function deleteAccount(): Promise<void> {
  if (!supabase) throw new Error('Not signed in.')
  const { error } = await supabase.rpc('delete_own_account')
  if (error) throw new Error(describeError(error))

  // Deleting the server copy is only half of it: this device still holds a
  // full local database, and the next sign-in would find that non-empty
  // local farm and adopt it as a brand new one — resurrecting exactly what
  // was just deleted.
  //
  // Done here and now rather than flagged for the next boot. The old path
  // flagged it and deleted the whole IndexedDB database on reload, which
  // blocks while any other tab has the app open and reported success on a
  // five-second timeout regardless — so with a second tab open the flag was
  // cleared, nothing was deleted, and a fresh signup inherited the lot.
  // Dropping the tables goes through this connection and cannot be blocked.
  await resetLocalData()
  await supabase.auth.signOut()
}
