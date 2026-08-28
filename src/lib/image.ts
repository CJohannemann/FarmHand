/**
 * Shrinking a camera photo down to something worth keeping a few hundred of.
 *
 * A phone photographs a receipt at 3–5MB. What anyone ever needs back from
 * it is whether the total says $340 and the date says April — legibility,
 * not resolution. Downscaling to a ~1400px long edge at JPEG quality 0.72
 * lands around 200KB, which is what makes storing these as rows in Postgres
 * reasonable rather than reckless: a few hundred purchases a year is tens of
 * megabytes, on a VPS that shares its disk with another site.
 *
 * This is also the only place the size promise is kept. Nothing downstream
 * re-checks it, so the cap here is what stands between a farm's database and
 * a year of unshrunk 5MB photos.
 */

/** Long edge, in pixels, after downscaling. Comfortably legible for print receipts. */
const MAX_EDGE = 1400

/**
 * JPEG quality. 0.72 is below where receipt text starts visibly degrading
 * and well below where file size stops falling — the curve is steep here, so
 * a little more compression buys a lot of room.
 */
const QUALITY = 0.72

/**
 * A hard ceiling, enforced after encoding rather than assumed. A photo of a
 * dense, glossy, full-page receipt can still land above the target even
 * downscaled, so the encoder is re-run at progressively lower quality
 * instead of letting an outlier through. Roughly 1MB of base64 once encoded.
 */
const MAX_BYTES = 700_000

export interface PreparedImage {
  /** Base64 payload, no data: prefix — what goes in receipt_blob.data. */
  data: string
  mime: string
  byteSize: number
  width: number
  height: number
}

export class ImageError extends Error {}

/**
 * Decode, downscale, re-encode as JPEG.
 *
 * createImageBitmap does the decode off the main thread and, with
 * imageOrientation: 'from-image', applies the EXIF rotation a phone camera
 * writes rather than baking in a sideways receipt — canvas drawing ignores
 * that tag otherwise, which is the classic "why is my photo rotated" bug.
 */
export async function prepareImage(file: File | Blob): Promise<PreparedImage> {
  if (file.size === 0) throw new ImageError('That file is empty.')
  if (!/^image\//.test(file.type)) {
    throw new ImageError('That file is not an image.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageError("That image couldn't be read. Try taking it again.")
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError("This browser couldn't process the image.")
    // Receipts are line art on white; a flat white ground keeps a source
    // image with transparency from encoding as black behind the text.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    let quality = QUALITY
    let blob = await encode(canvas, quality)
    // Three retries, not a loop to zero: past roughly 0.35 the text itself
    // starts breaking up, and an image nobody can read is worse than a large
    // one. If it is still oversized after that, say so rather than store it.
    for (let i = 0; i < 3 && blob.size > MAX_BYTES; i++) {
      quality -= 0.12
      blob = await encode(canvas, quality)
    }
    if (blob.size > MAX_BYTES) {
      throw new ImageError(
        "That image is too large to store even after shrinking. Try photographing " +
        'just the receipt, filling the frame.',
      )
    }

    return {
      data: await toBase64(blob),
      mime: 'image/jpeg',
      byteSize: blob.size,
      width,
      height,
    }
  } finally {
    bitmap.close()
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageError('Encoding the image failed.'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * FileReader rather than btoa over a byte string: btoa throws on any byte
 * above 0xFF once the string is built naively, and building it safely means
 * chunking through a 200KB array by hand for a result the browser already
 * knows how to produce.
 */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new ImageError('Reading the image failed.'))
    r.onload = () => {
      const url = String(r.result)
      const comma = url.indexOf(',')
      resolve(comma === -1 ? url : url.slice(comma + 1))
    }
    r.readAsDataURL(blob)
  })
}

/** Rebuilds a displayable src from what was stored. */
export function dataUrl(mime: string, data: string): string {
  return `data:${mime};base64,${data}`
}
