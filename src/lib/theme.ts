/**
 * Display theme is a device preference, not farm data — it lives in
 * localStorage rather than syncing, same as the other per-device flags in
 * this codebase (see db/cutover.ts).
 */
export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'farmhand:theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** Stamps <html data-theme> so index.css can pick the right token set. */
export function applyThemePref(pref: ThemePref = getThemePref()) {
  const el = document.documentElement
  if (pref === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', pref)
}

export function setThemePref(pref: ThemePref) {
  if (pref === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, pref)
  applyThemePref(pref)
}
