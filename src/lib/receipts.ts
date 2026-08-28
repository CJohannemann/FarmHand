import { supabase } from './supabase'
import { applying } from '../db/client'
import {
  putReceiptData, receiptData, receiptsForYear, type ReceiptForExport,
} from '../db/queries'
import { base64ToBytes, csvField, makeZip, safeFileName } from './zip'

/**
 * The on-demand half of receipt storage.
 *
 * A receipt's metadata syncs with everything else, so any device can list
 * what exists. The image itself is deliberately left on the server (see
 * PUSH_ONLY_TABLES in syncCore.ts) and fetched only when something actually
 * needs to show or export it — otherwise signing in on a new phone would
 * pull down every receipt the farm has ever taken.
 */

/**
 * The image bytes for one receipt, from this device if it has them and from
 * the server otherwise. Null means neither had it: the photo was taken on
 * another device and this one is offline.
 *
 * A fetched blob is cached locally inside applying(), which suppresses the
 * outbox trigger — without it, every image this device merely *looked at*
 * would queue itself to be pushed straight back to the server it came from.
 */
export async function fetchReceiptData(id: string): Promise<string | null> {
  const cached = await receiptData(id)
  if (cached) return cached
  if (!supabase || !navigator.onLine) return null

  const { data, error } = await supabase
    .from('receipt_blob').select('data').eq('receipt_id', id).maybeSingle()
  if (error || !data?.data) return null

  await applying(async () => { await putReceiptData(id, data.data as string) })
  return data.data as string
}

export interface ExportProgress {
  /** How many receipts have been resolved so far, for a progress line. */
  done: number
  total: number
}

export interface YearExport {
  filename: string
  bytes: Uint8Array
  included: number
  /** Receipts whose image couldn't be got — listed in the CSV, absent as files. */
  missing: number
}

/**
 * Assemble one tax year into a ZIP: the images, named so they sort by date,
 * plus an index.csv tying each file back to what was bought and for how much.
 *
 * Fetched one at a time rather than in parallel. A year is tens of megabytes
 * over what may be a phone connection, and forty simultaneous requests is
 * how you get a stalled export and a rate limit rather than a fast one.
 *
 * A receipt whose image cannot be retrieved is NOT silently dropped: it stays
 * in the CSV with an empty file column, so the row count still matches the
 * books and the gap is visible rather than invisible.
 */
export async function exportYear(
  year: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<YearExport> {
  const rows = await receiptsForYear(year)
  const entries: { name: string; data: Uint8Array; modified?: Date }[] = []
  const csv: string[] = ['date,supplier,item,amount,file,note']
  const seen = new Map<string, number>()
  let missing = 0

  for (const [i, r] of rows.entries()) {
    onProgress?.({ done: i, total: rows.length })
    const date = r.timestamp.slice(0, 10)
    const data = await fetchReceiptData(r.id)

    let filename = ''
    let note = ''
    if (data) {
      filename = uniqueName(seen, buildName(r, date))
      entries.push({
        name: filename,
        data: base64ToBytes(data),
        modified: new Date(r.timestamp),
      })
    } else {
      missing++
      note = 'image not available on this device'
    }

    csv.push([
      csvField(date), csvField(r.supplier), csvField(r.purchase_name),
      csvField(r.amount), csvField(filename), csvField(note),
    ].join(','))
  }
  onProgress?.({ done: rows.length, total: rows.length })

  // A leading BOM so Excel opens the file as UTF-8 rather than the local
  // code page — without it a supplier named "Café" arrives as "CafÃ©" in the
  // one program most likely to open this.
  entries.unshift({
    name: 'index.csv',
    data: new TextEncoder().encode('﻿' + csv.join('\r\n') + '\r\n'),
  })

  return {
    filename: `farmhand-receipts-${year}.zip`,
    bytes: makeZip(entries),
    included: entries.length - 1,
    missing,
  }
}

/** `2026-04-12_Co-op_340.00.jpg` — date first, so a plain sort is chronological. */
function buildName(r: ReceiptForExport, date: string): string {
  const parts = [date]
  if (r.supplier) parts.push(r.supplier)
  else if (r.purchase_name) parts.push(r.purchase_name)
  if (r.amount != null) parts.push(Number(r.amount).toFixed(2))
  const ext = r.mime === 'image/png' ? 'png' : 'jpg'
  return `${safeFileName(parts.join('_'))}.${ext}`
}

/**
 * Two feed purchases from the same supplier on the same day for the same
 * amount produce identical names, and a ZIP with two identical entries
 * extracts as one file silently overwriting the other — losing a receipt
 * from a tax export without saying so.
 */
function uniqueName(seen: Map<string, number>, name: string): string {
  const n = seen.get(name) ?? 0
  seen.set(name, n + 1)
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return `${name.slice(0, dot)}-${n + 1}${name.slice(dot)}`
}

/**
 * Hand the finished archive to the browser. Revoking on a timeout rather
 * than immediately: Safari in particular navigates to the blob URL
 * asynchronously, and revoking in the same tick cancels the download it was
 * about to start.
 */
export function downloadZip(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
