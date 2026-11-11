import { useRef, useState } from 'react'
import { prepareImage, ImageError, dataUrl, type PreparedImage } from '../lib/image'

/**
 * Attach a photo of the receipt to what was just bought.
 *
 * Two buttons, two file inputs: Take photo (with `capture`, straight to
 * the rear camera) and Choose from library (without it). It used to be one
 * input with `capture` set, and on an iPhone that skips the usual "Photo
 * Library / Take Photo" menu and opens the camera outright — so a receipt
 * photographed earlier could not be attached at all. Reported exactly so,
 * by someone trying to add one from their library to a past purchase.
 *
 * On a desktop both open the ordinary file picker, and the drop zone takes
 * a dragged image.
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
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
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
      for (const r of [cameraRef, libraryRef]) if (r.current) r.current.value = ''
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
      >
        {preview ? (
          <img src={preview} alt="The receipt you attached" className="receipt-thumb" />
        ) : busy ? (
          <p className="muted">Shrinking the photo…</p>
        ) : (
          <div className="receipt-buttons">
            <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()}>
              📷 Take photo
            </button>
            <button type="button" disabled={disabled} onClick={() => libraryRef.current?.click()}>
              🖼️ Choose from library
            </button>
          </div>
        )}
      </div>

      {/* `capture` sends this one straight to the rear camera on a phone. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        disabled={disabled || busy} onChange={(e) => take(e.target.files?.[0])} />
      {/* No `capture`: the phone's own picker, photo library included. */}
      <input ref={libraryRef} type="file" accept="image/*" hidden
        disabled={disabled || busy} onChange={(e) => take(e.target.files?.[0])} />

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
