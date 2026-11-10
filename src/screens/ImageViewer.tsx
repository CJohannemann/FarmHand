import { useEffect, useRef, useState, type MouseEvent } from 'react'

/**
 * A photo, full screen — for reading a receipt's small print on a phone,
 * which at the width of the list it sits in is a blur of part numbers.
 *
 * Opens fitted to the screen. A tap zooms in on the spot tapped, to well
 * past the screen's width, and the photo is then dragged around by
 * scrolling; another tap fits it back. Its own zoom rather than the
 * browser's pinch: a pinch zooms the whole page, close button and all, and
 * can leave it zoomed after closing.
 */
export function ImageViewer({ src, alt, onClose }: {
  src: string; alt: string; onClose: () => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const pane = useRef<HTMLDivElement>(null)
  // Where the zooming tap landed, as a fraction of the photo across and down.
  const focus = useRef({ x: 0.5, y: 0.5 })

  // Escape closes, and the page underneath stops scrolling while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  // Once zoomed in, bring the tapped spot to the middle of the screen.
  useEffect(() => {
    const el = pane.current
    if (!zoomed || !el) return
    el.scrollLeft = focus.current.x * el.scrollWidth - el.clientWidth / 2
    el.scrollTop = focus.current.y * el.scrollHeight - el.clientHeight / 2
  }, [zoomed])

  const tap = (e: MouseEvent<HTMLImageElement>) => {
    if (!zoomed) {
      const r = e.currentTarget.getBoundingClientRect()
      focus.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    }
    setZoomed((z) => !z)
  }

  return (
    <div className="imageviewer" role="dialog" aria-label={alt}>
      <div ref={pane} className={zoomed ? 'imageviewer-pane zoomed' : 'imageviewer-pane'}>
        <img src={src} alt={alt} onClick={tap} />
      </div>
      <button className="imageviewer-close" aria-label="Close" onClick={onClose}>✕</button>
      <p className="imageviewer-hint">{zoomed ? 'Drag to look around · tap to fit' : 'Tap to zoom in'}</p>
    </div>
  )
}
