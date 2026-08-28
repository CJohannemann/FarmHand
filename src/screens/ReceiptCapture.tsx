import { useRef, useState } from 'react'
import { prepareImage, ImageError, dataUrl, type PreparedImage } from '../lib/image'

/**
 * Attach a photo of the receipt to what was just bought.
 *
 * One `<input type="file" accept="image/*">` covers both halves of the
 * request: on a phone it offers the camera (and `capture` nudges the rear
 * one), on a desktop it opens the file picker. The drop zone wrapped around
 * it is desktop-only in practice, since nothing drags on touch — but it
 * costs three handlers rather than a separate code path.
 *
 * The image is downscaled here, before it is handed anywhere, so the caller
 * never sees a 5MB camera original. See lib/image.ts for why that cap is
 * what makes storing these in Postgres reasonable.
 */
export function ReceiptCapture({ onChange, disabled }: {
  /** The prepared image, or null when it's been removed. */
  onChange: (image: PreparedImage | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const take = async (file: File | null | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const image = await prepareImage(file)
      setPreview(dataUrl(image.mime, image.data))
      onChange(image)
    } catch (e) {
      // An ImageError is already phrased for a person; anything else is a
      // surprise and shouldn't be shown raw.
      setError(e instanceof ImageError ? e.message : "That image couldn't be read.")
    } finally {
      setBusy(false)
      // Clearing the input matters: picking the same file twice in a row
      // fires no change event otherwise, so a retry after an error would
      // look like nothing happened.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="field">
      <span>Receipt (optional)</span>

      <div
        className={`dropzone${dragging ? ' over' : ''}${preview ? ' has-image' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          take(e.dataTransfer.files?.[0])
        }}
        onClick={() => !busy && !disabled && inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="The receipt you attached" className="receipt-thumb" />
        ) : (
          <p className="muted">
            {busy ? 'Shrinking the photo…' : 'Take a photo, or drop an image here'}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Hints the rear camera on a phone. Ignored on desktop, which shows
        // an ordinary file picker — one control, both platforms.
        capture="environment"
        hidden
        disabled={disabled || busy}
        onChange={(e) => take(e.target.files?.[0])}
      />

      {preview && !busy && (
        <button type="button" className="linkish"
          onClick={() => { setPreview(null); onChange(null) }}>
          Remove
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
