import { useEffect, useRef } from 'react'
import landingHtml from './landing.html?raw'

/**
 * The marketing page a signed-out visitor sees first. It's a static design
 * (see docs/landing-drafts) rendered as-is via dangerouslySetInnerHTML —
 * rewriting a hand-designed page into JSX line by line would just be a
 * chance to introduce a mismatch. Its own CTAs point at #signin/#signup
 * instead of a real URL; a single delegated click handler catches those
 * (event bubbling means one listener on the wrapper sees every click
 * inside) and hands off to the real auth screen instead of reloading the
 * page — in whichever mode the specific CTA implies, so "Start your farm's
 * records" opens account creation rather than a sign-in form for an
 * account that (for a first-time visitor) doesn't exist yet.
 *
 * The design's own <script> (scroll-driven screenshot swap, fade-in
 * reveals) is stripped out of landing.html: a <script> tag set via
 * innerHTML never executes — that's a browser rule, not a React one — so
 * it would just sit there inert. Reimplemented below instead.
 */
export function Landing({ signedIn, onSignIn, onOpenApp }: {
  /**
   * The page stays reachable at '/' after signing in — it's the public
   * front door, not a signed-out-only interstitial — so every CTA on it
   * would otherwise be inviting someone to sign in to an account they are
   * already using. Each one carries the wording for that case in a
   * data-signed-in attribute, so the alternate copy lives beside the
   * original in the design rather than in a lookup table over here.
   */
  signedIn: boolean
  onSignIn: (mode: 'in' | 'up') => void
  onOpenApp: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    let teardown: (() => void) | null = null
    const attach = () => {
      teardown?.()
      teardown = wireUpInteractivity(root)
      if (signedIn) relabelForSignedIn(root)
    }
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
  }, [signedIn])

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest('[data-action="signin"], [data-action="signup"]')
        if (!target) return
        e.preventDefault()
        if (signedIn) { onOpenApp(); return }
        onSignIn((target as HTMLElement).dataset.action === 'signup' ? 'up' : 'in')
      }}
      dangerouslySetInnerHTML={{ __html: landingHtml }}
    />
  )
}

/** Swaps each CTA to the wording landing.html carries for a signed-in reader. */
function relabelForSignedIn(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-signed-in]').forEach((el) => {
    el.textContent = el.dataset.signedIn ?? el.textContent
  })
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
