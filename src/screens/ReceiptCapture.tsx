import { useEffect, useRef, useState } from 'react'
import { prepareImage, ImageError, dataUrl, type PreparedImage } from '../lib/image'

/**
 * Attach a photo of the receipt to what was just bought.
 *
 * One tap target over one `<input type="file" accept="image/*">`, with no
 * `capture` attribute. That matters: with `capture` set, an iPhone opens
 * the camera outright and skips its own Photo Library / Take Photo menu,
 * so a receipt already photographed could not be attached at all. Without
 * it the phone offers both, in its own familiar menu — which looks better
 * than two buttons of ours side by side doing the same job (tried, and
 * called out as looking wrong). On a desktop it is the ordinary file
 * picker, and the area also takes a dragged image.
 *
 * The image is downscaled here, before it is handed anywhere, so the caller
 * never sees a 5MB camera original. See lib/image.ts for why that cap is
 * what makes storing these in Postgres reasonable.
 */
export function ReceiptCapture({ onChange, disabled, value }: {
  /** The prepared image, or null when it's been removed. */
  onChange: (image: PreparedImage | null) => void
  disabled?: boolean
  /**
   * A photo the form already has — the one just scanned on the Buy sheet,
   * so a receipt read in is a receipt attached without picking it twice.
   */
  value?: PreparedImage | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (value !== undefined) setPreview(value ? dataUrl(value.mime, value.data) : null)
  }, [value])

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
        role="button" tabIndex={0}
        onClick={() => !busy && !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      >
        {preview ? (
          <img src={preview} alt="The receipt you attached" className="receipt-thumb" />
        ) : busy ? (
          <p className="muted">Shrinking the photo…</p>
        ) : (
          <div className="receipt-prompt">
            <span className="receipt-prompt-icon" aria-hidden="true">🧾</span>
            <span className="receipt-prompt-title">Add receipt photo</span>
            <span className="receipt-prompt-sub">Take a picture or choose one you already have</span>
          </div>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" hidden
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
