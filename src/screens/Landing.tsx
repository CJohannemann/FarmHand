import { useEffect, useRef } from 'react'
import landingHtml from './landing.html?raw'

/**
 * The marketing page a signed-out visitor sees first. It's a static design
 * (see docs/landing-drafts) rendered as-is via dangerouslySetInnerHTML —
 * rewriting a hand-designed page into JSX line by line would just be a
 * chance to introduce a mismatch. Its own CTAs point at #signin instead of
 * a real URL; a single delegated click handler catches those (event
 * bubbling means one listener on the wrapper sees every click inside) and
 * hands off to the real sign-in screen instead of reloading the page.
 *
 * The design's own <script> (scroll-driven screenshot swap, fade-in
 * reveals) is stripped out of landing.html: a <script> tag set via
 * innerHTML never executes — that's a browser rule, not a React one — so
 * it would just sit there inert. Reimplemented below instead.
 */
export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    let teardown: (() => void) | null = null
    const attach = () => { teardown?.(); teardown = wireUpInteractivity(root) }
    attach()

    // React can re-render this div's dangerouslySetInnerHTML content — an
    // unrelated app-level re-render while this screen is up is enough —
    // which replaces every element below it even though the markup string
    // never changes. A childList mutation on `root` is exactly that
    // replacement, so re-wiring on one keeps the observers pointed at
    // what's actually on screen instead of a detached, orphaned copy.
    const mo = new MutationObserver(attach)
    mo.observe(root, { childList: true })

    return () => { mo.disconnect(); teardown?.() }
  }, [])

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest('[data-action="signin"]')
        if (target) { e.preventDefault(); onSignIn() }
      }}
      dangerouslySetInnerHTML={{ __html: landingHtml }}
    />
  )
}

/** Scroll-driven pinned-screenshot swap, and a fade-in for two late sections. */
function wireUpInteractivity(root: HTMLElement): () => void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const captions = ['Inventory', 'Today', 'Analytics']
  const capEl = root.querySelector('#frame-cap')
  const beats = root.querySelectorAll('.beat[data-beat]')
  const images = root.querySelectorAll<HTMLElement>('.frame img[data-beat]')
  const reveals = root.querySelectorAll('.reveal')
  const observers: IntersectionObserver[] = []

  if (beats.length && images.length) {
    const tourIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const beat = (e.target as HTMLElement).dataset.beat
        images.forEach((img) => img.classList.toggle('active', img.dataset.beat === beat))
        if (capEl) capEl.textContent = captions[Number(beat)] ?? ''
      }
    }, { threshold: 0.5, rootMargin: '-20% 0px -20% 0px' })
    beats.forEach((b) => tourIo.observe(b))
    observers.push(tourIo)
  }

  if (reduceMotion) {
    reveals.forEach((el) => el.classList.add('in'))
  } else if (reveals.length) {
    const revealIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('in')
        revealIo.unobserve(e.target)
      }
    }, { threshold: 0.12 })
    reveals.forEach((el) => revealIo.observe(el))
    observers.push(revealIo)
  }

  return () => observers.forEach((o) => o.disconnect())
}
