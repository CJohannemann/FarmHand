/**
 * Forgiving text matching for the search box.
 *
 * Subsequence rather than substring: every character of the query has to
 * appear in the text in order, but not next to each other. That is what
 * lets "crkcorn" find "Cracked corn" and "sprlay" find "Spring layers" —
 * which is the whole point, since the farmer reaching for search is usually
 * half-remembering a name rather than spelling it.
 *
 * Finding things is only half of it. A subsequence match on its own ranks
 * "Chicken scratch" and "Cracked corn" identically for "cc", so the score
 * below is what keeps the obvious answer at the top.
 */

/**
 * Lowercased and stripped of accents, so "cafe" finds "Café".
 *
 * NFD splits an accented letter into the letter plus its mark, and the
 * range below deletes the marks — the standard trick, and the reason this
 * needs no lookup table of its own.
 */
function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Word starts: the first character, and anything after a space or dash. */
function isWordStart(text: string, i: number): boolean {
  return i === 0 || /[\s\-_/,.]/.test(text[i - 1])
}

/**
 * How well `query` matches `text` — higher is better — or null when the
 * query is not in there at all.
 *
 * Null rather than 0 on purpose: the caller has to tell "no match" from "a
 * poor one" to drop it entirely, and 0 cannot carry that.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalise(query.trim())
  const t = normalise(text)
  // An empty query matches nothing rather than everything. A search screen
  // showing the entire farm before a key is pressed is noise, not a result.
  if (!q || !t) return null

  if (q === t) return 1000
  if (t.startsWith(q)) return 900 - Math.min(t.length - q.length, 99)

  // Typed a real fragment of the name: rank it above anything assembled
  // out of scattered letters.
  //
  // This tier is not just a shortcut, it is a correctness fix. The walk
  // below is greedy from the left and takes the FIRST occurrence of each
  // character, not the best one — so "corn" against "Cracked corn" would
  // latch onto the c of "Cracked", then hunt forwards for o-r-n and score
  // the result as though it were scattered, missing that the word "corn"
  // is sitting right there. Finding the substring first sidesteps the
  // whole question of optimal alignment for the case that matters most.
  const whole = t.indexOf(q)
  if (whole !== -1) {
    return 800 - Math.min(whole, 40)
      + (isWordStart(t, whole) ? 30 : 0)
      - Math.min(Math.floor(t.length / 4), 20)
  }

  // Walk the query through the text, keeping what it cost to get there.
  let ti = 0
  let score = 0
  let firstAt = -1
  let previousAt = -1
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at === -1) return null
    if (firstAt === -1) firstAt = at
    // A character landing at the start of a word is a much better sign
    // than one landing mid-word: "cc" meaning Cracked corn rather than
    // two arbitrary c's out of "chicken scratch".
    if (isWordStart(t, at)) score += 12
    // Runs beat scatter. Adjacent characters are the substring case, which
    // is what someone typing a real fragment of the name produces.
    if (at === previousAt + 1) score += 8
    else score -= Math.min(at - previousAt - 1, 6)
    previousAt = at
    ti = at + 1
  }

  // Earlier is better, and so is shorter: with everything else equal, a
  // match at the front of a short name is the one meant.
  score += Math.max(0, 20 - firstAt)
  score += Math.max(0, 20 - Math.floor(t.length / 4))
  return score
}

/**
 * The matching items, best first.
 *
 * `textOf` can return several strings — a record is worth finding by what
 * it was called OR by which animal it was about — and the best of them
 * wins rather than being concatenated, so a query is never satisfied by
 * half-matching two unrelated fields at once.
 */
export function rank<T>(
  query: string, items: T[], textOf: (item: T) => (string | null | undefined)[],
): T[] {
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    let best: number | null = null
    for (const text of textOf(item)) {
      if (!text) continue
      const s = fuzzyScore(query, text)
      if (s !== null && (best === null || s > best)) best = s
    }
    if (best !== null) scored.push({ item, score: best })
  }
  // Stable within a score: sort() is stable in modern JS, so items keep
  // whatever order the caller handed them in — newest-first for records,
  // name order for stock — instead of an arbitrary shuffle.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item)
}
