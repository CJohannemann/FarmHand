import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function Sheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    // Without this the sheet stays put (it's fixed) but the page underneath
    // it keeps scrolling on touch, which reads as the sheet being unable to
    // scroll rather than the backdrop doing its job.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // A field's autoFocus pops the on-screen keyboard the instant the sheet
    // appears, before anyone's had a chance to read it — jarring on touch,
    // where opening the keyboard is a much bigger deal than on desktop.
    // Redirect focus to the dialog itself instead: focus stays inside the
    // sheet (not lost to whatever was behind it), but nothing summons the
    // keyboard until a field is tapped on purpose. Non-touch input doesn't
    // have this problem, so a mouse/keyboard user still lands in the field.
    if (window.matchMedia('(pointer: coarse)').matches) {
      (document.activeElement as HTMLElement | null)?.blur()
      dialogRef.current?.focus({ preventScroll: true })
    }

    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sheet"
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </div>
    </div>
  )
}
