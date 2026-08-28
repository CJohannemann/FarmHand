/**
 * A minimal ZIP writer, store mode only (no compression).
 *
 * Not a dependency, because the compressing half of a zip library is the
 * expensive, fiddly half and this app has no use for it: receipts are JPEGs
 * and index.csv is a few kilobytes. Deflating already-compressed JPEG data
 * spends CPU on a phone to make the file very slightly larger. What is left
 * once you drop compression is three fixed-layout records and a CRC — small
 * enough to read in one sitting, which is worth more here than saving those
 * lines.
 *
 * No ZIP64: that format exists for archives past 4GB, and a year of a farm's
 * receipts is measured in tens of megabytes. The limit is asserted rather
 * than assumed, so an impossible year fails loudly instead of writing a file
 * that silently truncates.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
  /** Defaults to now. ZIP stores local time with 2-second precision. */
  modified?: Date
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const MAX_ZIP = 0xffffffff

/** Bit 11 tells the reader the filename is UTF-8 rather than the DOS code page. */
const FLAG_UTF8 = 0x0800

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** ZIP inherited MS-DOS's packed date/time: 2-second precision, epoch 1980. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export function makeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const names = entries.map((e) => enc.encode(e.name))

  const localSize = entries.reduce((n, e, i) => n + 30 + names[i].length + e.data.length, 0)
  const centralSize = entries.reduce((n, _, i) => n + 46 + names[i].length, 0)
  const total = localSize + centralSize + 22
  if (total > MAX_ZIP) {
    throw new Error('That export is over 4GB, which this archive format cannot hold.')
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let at = 0
  const u16 = (v: number) => { view.setUint16(at, v, true); at += 2 }
  const u32 = (v: number) => { view.setUint32(at, v >>> 0, true); at += 4 }
  const raw = (b: Uint8Array) => { out.set(b, at); at += b.length }

  const offsets: number[] = []
  const crcs: number[] = []

  entries.forEach((e, i) => {
    const { time, date } = dosDateTime(e.modified ?? new Date())
    const crc = crc32(e.data)
    offsets.push(at)
    crcs.push(crc)

    u32(LOCAL_SIG)
    u16(20)                 // version needed: 2.0, which is store + deflate
    u16(FLAG_UTF8)
    u16(0)                  // method 0 = stored
    u16(time); u16(date)
    u32(crc)
    u32(e.data.length)      // compressed size == uncompressed, stored
    u32(e.data.length)
    u16(names[i].length)
    u16(0)                  // no extra field
    raw(names[i])
    raw(e.data)
  })

  const centralStart = at

  entries.forEach((e, i) => {
    const { time, date } = dosDateTime(e.modified ?? new Date())
    u32(CENTRAL_SIG)
    u16(20)                 // version made by
    u16(20)                 // version needed
    u16(FLAG_UTF8)
    u16(0)
    u16(time); u16(date)
    u32(crcs[i])
    u32(e.data.length)
    u32(e.data.length)
    u16(names[i].length)
    u16(0)                  // extra
    u16(0)                  // comment
    u16(0)                  // disk number
    u16(0)                  // internal attributes
    u32(0)                  // external attributes
    u32(offsets[i])
    raw(names[i])
  })

  // Captured BEFORE the record below is written: u16/u32 advance `at` as a
  // side effect, so computing the directory's size inline would measure from
  // centralStart to partway through this very record and overstate it by the
  // 12 bytes already emitted. Info-ZIP reports that as "missing 12 bytes in
  // zipfile" and refuses to extract.
  const centralSizeWritten = at - centralStart

  u32(EOCD_SIG)
  u16(0); u16(0)            // single-disk archive
  u16(entries.length); u16(entries.length)
  u32(centralSizeWritten)
  u32(centralStart)
  u16(0)                    // no archive comment

  return out
}

/** Base64 (as stored in receipt_blob) to the raw bytes a zip entry needs. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * A filename safe to hand to someone else's computer.
 *
 * The archive itself stores names as UTF-8 and flags them as such, but that
 * flag is advisory and widely ignored — Info-ZIP 6.00, still the `unzip` on
 * plenty of machines, mangles `café` into `caf+®` on extraction. A tax
 * export is precisely the file that gets emailed to a bookkeeper running
 * unknown tools, so the names are reduced to characters nothing argues
 * about. Accents are folded rather than deleted (`café` → `cafe`), so a
 * supplier stays recognisable.
 *
 * Only the FILENAME is narrowed. index.csv carries the real supplier name in
 * full, where UTF-8 is not at the mercy of a 2009 extractor.
 */
export function safeFileName(name: string, fallback = 'receipt'): string {
  const folded = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // strip the combining accents NFD split out
    // Apostrophes are inside words, not between them — dropped rather than
    // turned into a separator, so O'Brien becomes OBrien and not O-Brien.
    // Both the typewriter and typographic forms, since a phone keyboard
    // produces the curly one.
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)
  return folded || fallback
}

/**
 * One CSV field. Quotes anything containing a delimiter, quote or newline,
 * and doubles embedded quotes — a supplier called `Bob's Feed, Inc.` would
 * otherwise silently split into two columns halfway through a tax export.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
