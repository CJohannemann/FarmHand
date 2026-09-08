/**
 * A JS-measured stand-in for `100dvh`, for a browser too old to recognize
 * the unit at all.
 *
 * A plain `100vh` fallback (see App.css's own comment on `.app`) isn't
 * enough on its own: on mobile, `vh` traditionally measures the *largest*
 * possible viewport — as if the browser's address bar were always hidden —
 * which is exactly the wrong-measurement problem `dvh` exists to fix.
 * `window.innerHeight` reflects the actual visible area at any given
 * moment, the same way `dvh` does, just computed in JS instead of read from
 * CSS. Recorded as a custom property so App.css can use it as a middle tier
 * between the universally-safe `vh` baseline and the `dvh` ideal: a browser
 * new enough for `dvh` ignores this entirely (the later declaration wins);
 * one new enough to run this script but not to know `dvh` gets an accurate
 * height anyway; only a browser too old for `resize`/`visualViewport` too
 * (vanishingly rare) ever actually falls back to plain `vh`.
 */
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`)
}

export function watchViewportHeight(): void {
  setAppHeight()
  window.addEventListener('resize', setAppHeight)
  // Android Chrome showing/hiding its address bar doesn't always fire a
  // plain `resize` — visualViewport's own resize event is what actually
  // catches that case there.
  window.visualViewport?.addEventListener('resize', setAppHeight)
}
