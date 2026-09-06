import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** How many sheets are open — see the lock in Sheet below. */
let openSheets = 0

export function Sheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    // Without this the sheet stays put (it's fixed) but the page underneath
    // it keeps scrolling on touch, which reads as the sheet being unable to
    // scroll rather than the backdrop doing its job.
    //
    // A class rather than an inline style on body: what scrolls behind a
    // sheet is `.scroll` inside the app shell (see App.css), but a sheet
    // also opens over screens that have no shell and scroll the page itself
    // — one class covers both, with the CSS deciding what it means where.
    //
    // Counted, because sheets can overlap: Stock's Add sheet opens the
    // species picker over itself, and the inner one unmounting must not
    // release a lock the outer one still needs.
    openSheets += 1
    document.body.classList.add('sheet-open')

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

    return () => {
      openSheets = Math.max(0, openSheets - 1)
      if (openSheets === 0) document.body.classList.remove('sheet-open')
    }
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
