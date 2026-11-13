/**
 * Reading a receipt photo with Google's Gemini, so the Buy sheet can fill
 * itself in: the store, the date, the total, and what was bought — enough
 * to say whether it was feed for the pigs or lumber for the barn.
 *
 * Each farm brings its own key. The app is open to anyone, and one shared
 * key would put every farm's receipts on one account and one free quota;
 * a key in the app's own code could be copied off any phone. So the farm
 * makes a free key in Google AI Studio, it is kept on the phone (see
 * getScanKey), and the phone calls Google directly — no server of ours in
 * the middle, nothing to pay for.
 *
 * Nothing here saves anything. It fills in a form that the person still
 * checks and saves, and every value it returns has been checked against
 * what the form can take (scanResultFrom): a kind not on the farm's list,
 * a date in the future, a negative total — each comes back as "unknown"
 * rather than as a wrong answer that looks right.
 *
 * Network calls go through a `fetch` passed in, so db/test/verify-receipt-
 * scan.ts can run all of it against canned replies.
 */

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Tried only if Google's own list of the key's models can't be had (see
 * pickScanModels, which is what normally decides). Named models before the
 * "-latest" alias: the alias was the one the first real scan sat waiting
 * on until it gave up.
 */
export const SCAN_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']

/**
 * The models to read a receipt with, from Google's list of what this key
 * can use — rather than names guessed in advance, which go stale as Google
 * retires and renames models (and one of which hung). Flash models that
 * can generateContent, stable before preview, newest first; one Flash-Lite
 * among them as the quick fallback; nothing for images, speech, live
 * audio, embeddings or experiments. At most three.
 */
export function pickScanModels(
  models: { name?: string; supportedGenerationMethods?: string[] }[],
): string[] {
  const version = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0)
  const usable = models
    .map((m) => ({ id: String(m.name ?? '').replace(/^models\//, ''), methods: m.supportedGenerationMethods ?? [] }))
    .filter((m) => m.id.includes('flash') && m.methods.includes('generateContent')
      && !/image|tts|audio|live|embed|exp|thinking|8b/.test(m.id))
  const rank = (id: string) => [
    /preview/.test(id) ? 1 : 0,              // stable first
    /latest/.test(id) ? 1 : 0,               // named before aliases
    -version(id),                            // newest first
    id.length,                               // "gemini-2.5-flash" before its dated twins
  ]
  const sorted = usable.map((m) => m.id).sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)]
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return a.localeCompare(b)
  })
  const full = sorted.filter((id) => !id.includes('lite'))
  const lite = sorted.filter((id) => id.includes('lite'))
  return [...new Set([full[0], lite[0], full[1], lite[1]].filter(Boolean) as string[])].slice(0, 3)
}

/** What the form needs to know about this farm to read a receipt for it. */
export interface ScanContext {
  /** The kinds a purchase can be (Feed, Building supplies, …). */
  kinds: string[]
  /** The species this farm keeps, for "who was the feed for". */
  species: string[]
  /** Stores already used, so "LOWE'S #1234" comes back as "Lowe's". */
  stores: string[]
  /** Today, YYYY-MM-DD, so a receipt date can be checked against it. */
  today: string
}

export interface ScanItem {
  description: string
  amount: number | null
  kind: string | null
  /** How much of it the line bought — 2 filters, 12.5 gal, 100 lb. */
  quantity: number | null
  /** The quantity's unit as the receipt gives it ("ea", "GAL"), or null. */
  unit: string | null
}

export interface ScanResult {
  store: string | null
  /** YYYY-MM-DD. */
  date: string | null
  total: number | null
  kind: string | null
  forSpecies: string | null
  items: ScanItem[]
}

/**
 * A failure phrased for the person holding the phone, plus `detail`: what
 * actually came back (or didn't), shown small under the message so a
 * screenshot of it says what went wrong. The first real scan failed with
 * only "couldn't reach Google" to go on, which could have meant four
 * different things.
 */
export class ScanError extends Error {
  readonly reason: 'no-key' | 'bad-key' | 'quota' | 'offline' | 'slow' | 'busy' | 'unreadable'
  readonly detail: string
  constructor(reason: ScanError['reason'], message: string, detail = '') {
    super(message)
    this.reason = reason
    this.detail = detail
  }
}

/**
 * How long one model is given before the next is tried. Reading a receipt
 * takes a working model seconds; one that has not answered in this long
 * is stuck, and waiting on it longer only made the first real scan sit
 * for a minute and a half before failing.
 */
export const SCAN_TIMEOUT_MS = 40_000

export function receiptPrompt(ctx: ScanContext): string {
  return [
    'You are reading a photo of a store receipt for a small farm\'s records.',
    'Return only the JSON described by the schema.',
    '',
    '- store: the store or business name as a person would say it, without store numbers,',
    '  addresses or legal suffixes. If it is one of these stores the farm already uses,',
    `  return that name exactly: ${ctx.stores.length ? ctx.stores.map((s) => JSON.stringify(s)).join(', ') : '(none yet)'}.`,
    '- date: the date of the purchase printed on the receipt or order (sale, transaction,',
    '  order or pickup date) as YYYY-MM-DD. US receipts print month first: 11/08/26 is',
    '  2026-11-08. Not the date the photo or screenshot was taken. null only if no date shows.',
    '- total: the final amount paid, including tax, as a number. null if unreadable.',
    `- kind: which ONE of these best describes the purchase as a whole: ${ctx.kinds.map((k) => JSON.stringify(k)).join(', ')}.`,
    '  Lumber, hardware, wire, conduit, fasteners and fencing are "Building supplies" if that is listed.',
    '  null if none fits.',
    ctx.species.length
      ? `- forSpecies: if the purchase is feed, hay or mineral clearly for one kind of animal, which one of: ${ctx.species.map((s) => JSON.stringify(s)).join(', ')} (hog/swine = Pig, layer/hen = Chicken, cow = Cattle). Otherwise null.`
      : '- forSpecies: null.',
    '- items: each line item, in order: a short plain description (expand abbreviations where obvious,',
    '  e.g. "16% HOG GRWR 50#" → "16% hog grower feed, 50 lb"), its line total as a number, and its kind',
    '  from the same list (or null). At most 30 items. Skip tax, subtotal, payment and change lines.',
    '  Also its quantity: how many or how much the line bought, as a number ("2 @ 7.05" is 2,',
    '  "12.500 GAL" is 12.5, one item with no count shown is 1), and that quantity\'s unit: "each" for',
    '  things counted, otherwise as printed (lb, gal, qt, oz). Bagged feed with the bag size shown is',
    '  its total weight: 2 bags of 50 lb is quantity 100, unit "lb". null for either if unsure.',
  ].join('\n')
}

/** The reply's shape, in the OpenAPI subset Gemini's responseSchema takes. */
export function receiptSchema(ctx: ScanContext): Record<string, unknown> {
  const kind = ctx.kinds.length
    ? { type: 'STRING', enum: ctx.kinds, nullable: true }
    : { type: 'STRING', nullable: true }
  const species = ctx.species.length
    ? { type: 'STRING', enum: ctx.species, nullable: true }
    : { type: 'STRING', nullable: true }
  return {
    type: 'OBJECT',
    properties: {
      store: { type: 'STRING', nullable: true },
      date: { type: 'STRING', nullable: true },
      total: { type: 'NUMBER', nullable: true },
      kind,
      forSpecies: species,
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            description: { type: 'STRING' },
            amount: { type: 'NUMBER', nullable: true },
            kind,
            quantity: { type: 'NUMBER', nullable: true },
            unit: { type: 'STRING', nullable: true },
          },
          required: ['description'],
        },
      },
    },
    required: ['store', 'date', 'total', 'kind', 'items'],
  }
}

/** The generateContent body: the photo, the prompt, JSON out. */
export function scanRequestBody(
  image: { data: string; mime: string }, ctx: ScanContext, withSchema = true, thinkingOff = true,
): Record<string, unknown> {
  return {
    contents: [{
      parts: [
        { inline_data: { mime_type: image.mime, data: image.data } },
        { text: receiptPrompt(ctx) },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      ...(withSchema ? { responseSchema: receiptSchema(ctx) } : {}),
      // Reading a receipt needs no deliberation, and a Flash model left to
      // "think" first can take long enough to look like no answer at all.
      // A model that won't have thinking turned off says so, and is asked
      // again without this (see scanReceipt).
      ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  }
}

const money = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v)
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null
}
const howMuch = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : Number(v)
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 1000) / 1000 : null
}
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}
/** The name from `list` that `v` is, ignoring case — or null. */
const oneOf = (v: unknown, list: string[]): string | null => {
  const t = text(v, 80)?.toLowerCase()
  return t ? list.find((x) => x.toLowerCase() === t) ?? null : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The day `t` names, as [year, month, day], in whichever way it was
 * written: 2026-11-08 (with or without a time after it), 2026/11/08,
 * 11/08/2026 or 11/8/26 (month first, as American receipts print it),
 * "Nov 8, 2026", "November 8 2026", "8 Nov 2026". Asked for YYYY-MM-DD,
 * a model still sometimes copies the date as the receipt shows it.
 */
const dateParts = (t: string): [number, number, number] | null => {
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/)
  if (m) return [+m[1], +m[2], +m[3]]
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|\s)/)
  if (m) return [m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]]
  const month = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/)
  if (m && month(m[1])) return [+m[3], month(m[1]), +m[2]]
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/)
  if (m && month(m[2])) return [+m[3], month(m[2]), +m[1]]
  return null
}

/**
 * The receipt's date as YYYY-MM-DD, if it is a real day, not after today,
 * and not absurdly old — a misread year ("2062") is no date at all rather
 * than a wrong one.
 */
export const receiptDate = (v: unknown, today: string): string | null => {
  const t = text(v, 40)
  const p = t && dateParts(t)
  if (!p) return null
  const iso = `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null
  const age = new Date(`${today}T12:00:00Z`).getTime() - d.getTime()
  return age >= 0 && age < 3 * 365 * 86_400_000 ? iso : null
}

/**
 * The model's reply, made safe for the form: only values the form can take,
 * everything else null. Takes the parsed JSON, whatever shape it came in.
 */
export function scanResultFrom(raw: unknown, ctx: ScanContext): ScanResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 30).flatMap((it): ScanItem[] => {
    const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
    const description = text(r.description, 120)
    return description ? [{
      description, amount: money(r.amount), kind: oneOf(r.kind, ctx.kinds),
      quantity: howMuch(r.quantity), unit: text(r.unit, 20),
    }] : []
  })
  const kind = oneOf(o.kind, ctx.kinds)
  return {
    store: oneOf(o.store, ctx.stores) ?? text(o.store, 60),
    date: receiptDate(o.date, ctx.today),
    total: money(o.total),
    kind,
    forSpecies: oneOf(o.forSpecies, ctx.species),
    items,
  }
}

/** The JSON text of a generateContent reply, fences and all stripped. */
export function replyJson(reply: unknown): unknown {
  const r = reply as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const t = r?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  const body = t.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  if (!body) throw new ScanError('unreadable', "Couldn't read anything from that photo.")
  try { return JSON.parse(body) } catch {
    throw new ScanError('unreadable', "Couldn't make sense of that receipt — fill it in by hand.")
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * A request that got no reply at all, told apart: out of time is not out of
 * signal, and both used to read as "couldn't reach Google". Whatever the
 * browser said goes in `detail` either way.
 */
function unreached(e: unknown, what: string): ScanError {
  const name = e instanceof Error ? e.name : 'Error'
  const detail = `${what}: ${name}: ${e instanceof Error ? e.message : String(e)}`
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ScanError('slow', 'Google took too long to answer. Try again — a closer, flatter photo of the receipt helps.', detail)
  }
  return new ScanError('offline', "Couldn't reach Google. Check the phone has signal and try again, or fill it in by hand.", detail)
}

/**
 * What a failed reply means. A ScanError ends the scan (a bad key, the
 * free limit); 'next-model' tries another model (this one is gone, or
 * overloaded); 'simplify' asks the same model again with less in the
 * request.
 *
 * 'simplify' is any other 400. Google's reply to a request a model won't
 * take is often just "Request contains an invalid argument", naming
 * nothing — reported exactly so from the first scan that reached
 * gemini-3.5-flash-lite — so which setting it objected to can't be read
 * off the message, only found by leaving settings out.
 */
async function failure(res: Response, model: string):
  Promise<{ outcome: ScanError | 'next-model' | 'simplify'; said: string }> {
  let detail = ''
  try { detail = JSON.stringify(await res.json()) } catch { /* not JSON */ }
  const said = `${model}: HTTP ${res.status} ${detail.slice(0, 200)}`
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(detail) || res.status === 401 || res.status === 403) {
    return { said, outcome: new ScanError('bad-key', "Google didn't accept the scanning key. Check it under Receipt scanning.", said) }
  }
  if (res.status === 429) {
    return { said, outcome: new ScanError('quota', "Google's free limit for this key is used up for now. Try again later, or fill it in by hand.", said) }
  }
  if (res.status === 400) return { said, outcome: 'simplify' }
  return { said, outcome: 'next-model' }
}

/**
 * The ways a request is put to one model, fullest first. Each step leaves
 * out one more thing a model might refuse: first the thinking setting
 * (newer models take thinking settings differently), then the strict reply
 * schema (the prompt asks for the same JSON in words, and the reply is
 * checked either way — see scanResultFrom).
 */
const REQUEST_STEPS = [
  { withSchema: true, thinkingOff: true, label: 'full' },
  { withSchema: true, thinkingOff: false, label: 'without the thinking setting' },
  { withSchema: false, thinkingOff: false, label: 'without the schema' },
] as const

/**
 * Reads a receipt photo. Tries the key's models in turn (see scanModels);
 * a model that turns the request down is asked again more simply (see
 * REQUEST_STEPS), one that hangs or is overloaded is left for the next.
 * Throws ScanError, phrased for the person, with every attempt in its
 * detail so a screenshot of a failure shows the whole story.
 */
/** The key's models to read with — Google's list if it can be had. */
/**
 * What one scan learns for the next: the key's model list, and which model
 * and form of request Google last answered. Without it every scan paid
 * for a model-list call and, on a model that turns the full request down,
 * a refused first try — a second or more each time, for nothing.
 *
 * Plain data, so the caller decides where it lives (loadScanMemory below
 * keeps it on the phone); a fresh {} remembers nothing.
 */
export interface ScanMemory {
  /** The key it was learned with — the last few characters, not the key. */
  keyEnd?: string
  models?: string[]
  /** When the model list was fetched, ms. */
  at?: number
  /** The model that last answered, and the REQUEST_STEPS index it took. */
  model?: string
  step?: number
}

const MODELS_FOR_MS = 7 * 86_400_000
const keyEnd = (key: string) => key.trim().slice(-6)

async function scanModels(key: string, fetchImpl: Fetch, mem: ScanMemory): Promise<string[]> {
  if (mem.keyEnd !== keyEnd(key)) {
    // A new key may see different models; nothing learned with the old one holds.
    for (const k of Object.keys(mem) as (keyof ScanMemory)[]) delete mem[k]
    mem.keyEnd = keyEnd(key)
  }
  if (mem.models?.length && Date.now() - (mem.at ?? 0) < MODELS_FOR_MS) return mem.models
  try {
    const res = await fetchImpl(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': key.trim() }, signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const picked = pickScanModels(((await res.json()) as { models?: [] }).models ?? [])
      if (picked.length) {
        mem.models = picked; mem.at = Date.now()
        return picked
      }
    }
  } catch { /* fall back to the names below */ }
  return SCAN_MODELS
}

export async function scanReceipt(
  key: string, image: { data: string; mime: string }, ctx: ScanContext,
  fetchImpl: Fetch = (u, i) => fetch(u, i),
  timeoutMs = SCAN_TIMEOUT_MS,
  mem: ScanMemory = {},
): Promise<ScanResult> {
  if (!key.trim()) throw new ScanError('no-key', 'Add a scanning key first.')
  const listed = await scanModels(key, fetchImpl, mem)
  // The model that answered last time goes first, from the step it took.
  const models = mem.model && listed.includes(mem.model)
    ? [mem.model, ...listed.filter((m) => m !== mem.model)] : listed
  const started = Date.now()
  const log: string[] = []
  let refused = false
  let hung = false
  for (const model of models) {
    const from = model === mem.model ? Math.min(mem.step ?? 0, REQUEST_STEPS.length - 1) : 0
    for (let i = from; i < REQUEST_STEPS.length; i++) {
      const step = REQUEST_STEPS[i]
      const t0 = Date.now()
      let res: Response
      try {
        res = await fetchImpl(`${GEMINI_BASE}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.trim() },
          body: JSON.stringify(scanRequestBody(image, ctx, step.withSchema, step.thinkingOff)),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (e) {
        const secs = Math.round((Date.now() - t0) / 1000)
        const err = unreached(e, `${model} after ${secs}s`)
        // No signal: no point trying anything else. Hung: try the next model.
        if (err.reason !== 'slow') throw err
        log.push(`${model}: no answer in ${secs}s`)
        hung = true
        break
      }
      if (res.ok) {
        const result = scanResultFrom(replyJson(await res.json()), ctx)
        mem.model = model; mem.step = i
        return result
      }
      const { outcome, said } = await failure(res, model)
      if (outcome instanceof ScanError) {
        throw new ScanError(outcome.reason, outcome.message, [...log, said].join(' · '))
      }
      log.push(`${step.label}: ${said}`)
      if (outcome === 'next-model') break
      refused = true // 'simplify': the next step, or the next model once out of steps
    }
  }
  // What answered last time didn't now; start from the top next time.
  delete mem.model; delete mem.step
  const detail = `${log.join(' · ')} (${Math.round((Date.now() - started) / 1000)}s)`
  if (refused) {
    throw new ScanError('unreadable', "Google turned the request down. Fill this one in by hand, and send the line below to whoever looks after the app.", detail)
  }
  if (hung) throw new ScanError('slow', 'Google took too long to answer. Try again in a bit, or fill it in by hand.', detail)
  throw new ScanError('busy', "Google's receipt reader isn't available right now. Fill it in by hand.", detail)
}

const MEMORY_KEY = 'farmhand:receiptScan:memory'

/** This phone's ScanMemory — {} where storage isn't available. */
export function loadScanMemory(): ScanMemory {
  try {
    const raw = globalThis.localStorage?.getItem(MEMORY_KEY)
    const m = raw ? JSON.parse(raw) : {}
    return m && typeof m === 'object' ? m : {}
  } catch { return {} }
}

export function saveScanMemory(mem: ScanMemory): void {
  try { globalThis.localStorage?.setItem(MEMORY_KEY, JSON.stringify(mem)) } catch { /* only a speed-up */ }
}

/**
 * Checks a key without spending any of its quota: listing models is free.
 * True if Google takes it; false if it says no; throws offline.
 */
export async function checkScanKey(key: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<boolean> {
  let res: Response
  try {
    res = await fetchImpl(`${GEMINI_BASE}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': key.trim() }, signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    throw unreached(e, 'key check')
  }
  return res.ok
}
