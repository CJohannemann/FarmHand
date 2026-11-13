/**
 * Telling when two names are the same thing written differently — "Hog
 * feed" and "Pig feed", "Lowes" and "Lowe's Home Improvement", "TSC" and
 * "Tractor Supply Co" — so the app can offer the one already in use before
 * a second spelling is saved, and find the pairs that slipped through.
 *
 * Two people on one farm naming things their own way was the worry that
 * prompted this: every spelling of a store is its own row in a project's
 * By store breakdown, and every name of a feed its own bag in Stores.
 *
 * Deliberately cautious. A wrong "did you mean" is a tap to dismiss; a
 * wrong automatic merge would be a mess to unpick, so nothing here merges
 * anything — it only says what looks alike.
 *
 * Pure, so db/test/verify-name-match.ts can pin it down.
 */

/** Words that mean the same animal, mapped to the one the species list uses. */
const SYNONYMS: Record<string, string> = {
  hog: 'pig', swine: 'pig', piglet: 'pig', pork: 'pig', sow: 'pig', boar: 'pig', gilt: 'pig',
  cow: 'cattle', cows: 'cattle', beef: 'cattle', calf: 'cattle', steer: 'cattle', heifer: 'cattle',
  hen: 'chicken', layer: 'chicken', broiler: 'chicken', pullet: 'chicken', poultry: 'chicken',
  doe: 'goat', kid: 'goat', ewe: 'sheep', lamb: 'sheep',
}

/** Words that say nothing about which store or thing it is. */
const FILLER = new Set(['the', 'inc', 'llc', 'co', 'company', 'corp', 'and', 'of'])

/**
 * Lower case, accents and punctuation gone, plurals and possessives folded
 * ("Lowe's", "Lowes" → "lowe"), animal synonyms to one word, filler words
 * dropped. Two names with the same canonical form are the same name.
 */
export function canonicalWords(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    // A hyphen inside a word joins it: "Co-op" is "coop", not "co" and "op".
    .replace(/([a-z0-9])-([a-z0-9])/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean)
    // Plurals and possessives: "lowes" → "lowe", "hogs" → "hog". Only past
    // three letters, and not -ss ("grass"), so short words keep their s.
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => !FILLER.has(w))
}

export const canonical = (s: string) => canonicalWords(s).join(' ')

/** Edit distance, capped — only ever asked whether two short names are 1–2 apart. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Whether two names look like the same thing:
 *  - the same once canonical ("Hog feed" / "pig feed", "Lowes" / "Lowe's");
 *  - one is the other with words added on the end ("Lowe's" / "Lowe's
 *    Home Improvement") — the shorter has to say something, so at least
 *    four letters;
 *  - one is the other's initials ("TSC" / "Tractor Supply Co" once "co" is
 *    dropped as filler reads "tractor supply" — so initials are checked
 *    against the words before filler is dropped as well);
 *  - a typo apart: one letter in a name of five or more, two in eight or
 *    more. Not four: "Feed" and "Seed" are one letter apart.
 */
export function similarNames(a: string, b: string): boolean {
  const wa = canonicalWords(a)
  const wb = canonicalWords(b)
  const ca = wa.join(' ')
  const cb = wb.join(' ')
  if (!ca || !cb) return false
  if (ca === cb) return true

  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (short.join('').length >= 4 && short.every((w, i) => long[i] === w)) return true

  const initials = (s: string) => s.toLowerCase().replace(/['’`]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join('')
  const single = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [x, y] of [[a, b], [b, a]]) {
    const ini = initials(y)
    if (ini.length >= 2 && single(x) === ini && !/\s/.test(x.trim())) return true
  }

  const d = distance(ca, cb)
  const len = Math.min(ca.length, cb.length)
  return (len >= 5 && d <= 1) || (len >= 8 && d <= 2)
}

export interface NameUse { name: string; count: number }

/**
 * The names already in use worth offering while something is typed — a
 * list that narrows with each letter, capitals ignored. In order:
 *  1. names that start with what was typed ("t" → TSC, Tractor Supply);
 *  2. names with a later word that does ("s" → Tractor Supply);
 *  3. names that look alike without matching at all ("Lowse" → Lowe's).
 * Within each, most used first. Nothing typed offers the most used, so
 * the usual store is one tap. Empty once the exact name is in the field.
 */
export function suggestNames(input: string, used: NameUse[], limit = 50): NameUse[] {
  const typed = input.trim().toLowerCase()
  const q = canonical(input)
  const byUse = [...used].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  if (!typed) return byUse.slice(0, limit)
  if (used.some((u) => u.name.toLowerCase() === typed)) return []
  // Plain lower case as well as canonical: canonical drops "The" and folds
  // plurals, and someone typing "the co" expects "The Co-op".
  const startsWith = (u: NameUse) => u.name.toLowerCase().startsWith(typed)
    || (!!q && canonical(u.name).startsWith(q))
  const wordStarts = (u: NameUse) =>
    // Apostrophes dropped first, so "Lowe's" is one word and "s" no match.
    u.name.toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).some((w) => w.startsWith(typed))
    || (!!q && canonicalWords(u.name).some((w) => w.startsWith(q)))
  const starts = byUse.filter(startsWith)
  const words = byUse.filter((u) => !starts.includes(u) && wordStarts(u))
  const alike = byUse.filter((u) => !starts.includes(u) && !words.includes(u)
    && similarNames(input, u.name))
  return [...starts, ...words, ...alike].slice(0, limit)
}

/**
 * The name already in use that `input` is probably meant to be, if any:
 * one that looks alike without being exactly what was typed. Most used wins.
 */
export function didYouMean(input: string, used: NameUse[]): string | null {
  const t = input.trim()
  if (!t || used.some((u) => u.name === t)) return null
  const hit = [...used].sort((a, b) => b.count - a.count).find((u) => similarNames(t, u.name))
  return hit?.name ?? null
}

/**
 * Pairs of names in use that look like the same thing — for Settings' tidy
 * up. Each pair is ordered to merge the less used into the more used.
 */
export function likelyDuplicates(used: NameUse[]): { from: NameUse; into: NameUse }[] {
  const out: { from: NameUse; into: NameUse }[] = []
  const sorted = [...used].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (similarNames(sorted[i].name, sorted[j].name)) out.push({ from: sorted[j], into: sorted[i] })
    }
  }
  return out
}

/**
 * How a "Not the same" answer is kept: the two names, whichever way round
 * they were offered, so the pair stays answered when one of them later
 * gets more uses and the suggestion would flip direction. Case is ignored
 * the way similarNames ignores it.
 */
export function notSameKey(kind: string, a: string, b: string): string {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort()
  return `${kind}:${x}|${y}`
}
