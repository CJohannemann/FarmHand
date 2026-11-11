// Reading a receipt photo with Gemini, against canned replies.
//
// No real call to Google is made here: scanReceipt() takes its fetch as a
// parameter, and each case below hands it a reply Google could give. The
// rules worth pinning are what the form is filled with — only values it
// can take, nothing that looks right and isn't — and what the person is
// told when it does not work: a bad key, the free limit, no signal.
//
//   npm run verify:receipt-scan
import {
  SCAN_MODELS, ScanError, checkScanKey, pickScanModels, receiptPrompt, receiptSchema, replyJson, scanReceipt,
  scanRequestBody, scanResultFrom, type ScanContext,
} from '../../src/lib/receiptScan.ts'
import { isMixed, linesFromScan, quickFillFromScan } from '../../src/lib/scanToForm.ts'
import { QUICK_KINDS } from '../../src/lib/purchaseKinds.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const ctx: ScanContext = {
  kinds: ['Feed', 'Hay', 'Building supplies', 'Medicine', 'Fuel', 'Parts', 'Improvements'],
  species: ['Cattle', 'Chicken', 'Pig'],
  stores: ["Lowe's", 'Wiseway', 'Tractor Supply Co'],
  today: '2026-11-11',
}
const image = { data: 'QUJD', mime: 'image/jpeg' }

/** A generateContent reply carrying `json` as its text. */
const reply = (json: unknown, fence = false) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: (fence ? '```json\n' : '') + JSON.stringify(json) + (fence ? '\n```' : '') }] } }],
}), { status: 200 })
const error = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/**
 * A fetch that answers receipt requests from a queue, and records them.
 * The model-list request a scan starts with is answered from `models`
 * (by default a 404, so the built-in names are used); checkScanKey's own
 * list request goes through the queue like anything else.
 */
function fakeFetch(answers: (Response | Error)[], models?: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = async (url: string, init: RequestInit) => {
    if (url.includes('/models?pageSize=200')) {
      return models ? new Response(JSON.stringify({ models }), { status: 200 }) : new Response('{}', { status: 404 })
    }
    calls.push({ url, init })
    const a = answers.shift()
    if (!a) throw new Error('no more answers')
    if (a instanceof Error) throw a
    return a
  }
  return { f, calls }
}
const fails_with = async (p: Promise<unknown>) => {
  try { await p; return null } catch (e) { return e instanceof ScanError ? e : null }
}

console.log('\nThe request')
const body = scanRequestBody(image, ctx) as {
  contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown>
}
check('sends the photo inline', JSON.stringify(body.contents[0].parts[0]) ===
  JSON.stringify({ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }))
check('asks for JSON with a schema', body.generationConfig.responseMimeType === 'application/json'
  && !!body.generationConfig.responseSchema)
const schema = receiptSchema(ctx) as { properties: Record<string, { enum?: string[] }> }
check('the kind can only be one of the farm\'s kinds', schema.properties.kind.enum?.join() === ctx.kinds.join())
check('the animal only one the farm keeps', schema.properties.forSpecies.enum?.join() === 'Cattle,Chicken,Pig')
check('the prompt names the stores already used, so "LOWE\'S #1234" comes back as Lowe\'s',
  receiptPrompt(ctx).includes('"Lowe\'s"'))
check('with no animals yet, the schema still works (no empty enum)',
  !(receiptSchema({ ...ctx, species: [] }) as { properties: Record<string, { enum?: string[] }> })
    .properties.forSpecies.enum)

console.log('\nA good reply fills the form')
const wiseway = {
  store: 'Wiseway', date: '2026-10-08', total: 123.64, kind: 'Building supplies', forSpecies: null,
  items: [{ description: '1-1/4" PVC conduit, 10 ft', amount: 84.93, kind: 'Building supplies' },
    { description: '4x4x2 PVC junction box', amount: 23.21, kind: 'Building supplies' }],
}
{
  const { f, calls } = fakeFetch([reply(wiseway)])
  const r = await scanReceipt('KEY123', image, ctx, f)
  check('store, date, total and kind', r.store === 'Wiseway' && r.date === '2026-10-08'
    && r.total === 123.64 && r.kind === 'Building supplies', JSON.stringify(r))
  check('and the line items', r.items.length === 2 && r.items[0].amount === 84.93)
  check('the key goes in a header, never the URL', !calls[0].url.includes('KEY123')
    && (calls[0].init.headers as Record<string, string>)['x-goog-api-key'] === 'KEY123')
  check('the first model tried is the "latest Flash" alias', calls[0].url.includes(`/models/${SCAN_MODELS[0]}:generateContent`))
}

console.log('\nValues the form cannot take come back as unknown')
const odd = scanResultFrom({
  store: "  lowe's  ", date: '2027-03-01', total: -5, kind: 'Groceries', forSpecies: 'hog',
  items: [{ description: '', amount: 3 }, { description: 'Hog grower', amount: '$18.99', kind: 'feed' }, 'junk'],
}, ctx)
check('a known store in other capitals is the farm\'s own spelling', odd.store === "Lowe's", String(odd.store))
check('a date after today is no date', odd.date === null)
check('a negative total is no total', odd.total === null)
check('a kind not on the farm\'s list is no kind', odd.kind === null)
check('an animal not on the list is no animal', odd.forSpecies === null)
check('blank and malformed items are dropped', odd.items.length === 1, JSON.stringify(odd.items))
check('"$18.99" is read as 18.99, and "feed" as Feed', odd.items[0].amount === 18.99 && odd.items[0].kind === 'Feed')
check('a misread year is no date', scanResultFrom({ date: '2062-10-08' }, ctx).date === null)
check('nor is a day that does not exist', scanResultFrom({ date: '2026-02-30' }, ctx).date === null)
check('a new store is kept as read', scanResultFrom({ store: 'Rural King #212' }, ctx).store === 'Rural King #212')
check('a reply that is not an object fills nothing',
  JSON.stringify(scanResultFrom('nope', ctx)) === JSON.stringify(
    { store: null, date: null, total: null, kind: null, forSpecies: null, items: [] }))
check('a reply wrapped in ```json fences still reads', (replyJson({
  candidates: [{ content: { parts: [{ text: '```json\n{"total": 5}\n```' }] } }],
}) as { total: number }).total === 5)

console.log('\nWhen it does not work, the person is told why')
{
  const e = await fails_with(scanReceipt('', image, ctx, fakeFetch([]).f))
  check('no key: asks for one', e?.reason === 'no-key')
}
{
  const e = await fails_with(scanReceipt('BAD', image, ctx, fakeFetch([error(400, {
    error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
      details: [{ reason: 'API_KEY_INVALID' }] },
  })]).f))
  check('a bad key says so', e?.reason === 'bad-key', e?.message)
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([error(429, { error: { status: 'RESOURCE_EXHAUSTED' } })]).f))
  check('the free limit says so', e?.reason === 'quota')
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([new TypeError('Failed to fetch')]).f))
  check('no signal says so', e?.reason === 'offline')
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([error(503, { error: { status: 'UNAVAILABLE' } })]).f))
  check('Google overloaded says try again', e?.reason === 'busy')
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sorry, I cannot read this.' }] } }] })),
  ]).f))
  check('a reply that is not JSON says fill it in by hand', e?.reason === 'unreadable')
}

{
  const timeout = () => Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch(SCAN_MODELS.map(timeout)).f, 5))
  check('too slow is not called no signal', e?.reason === 'slow', e?.message)
  check('and says which models it waited on', SCAN_MODELS.every((m) => e?.detail.includes(m)), e?.detail)
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([new TypeError('Load failed')]).f))
  check('no reply at all carries the browser\'s own words', !!e?.detail.includes('TypeError: Load failed'), e?.detail)
}
{
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch([error(429, { error: { status: 'RESOURCE_EXHAUSTED' } })]).f))
  check('an HTTP failure carries its status', !!e?.detail.includes('HTTP 429'), e?.detail)
}

console.log('\nIt carries on past what it can')
{
  const { f, calls } = fakeFetch([error(404, { error: { status: 'NOT_FOUND' } }), reply(wiseway)])
  const r = await scanReceipt('K', image, ctx, f)
  check('a retired model moves on to the next', r.total === 123.64 && calls[1].url.includes(SCAN_MODELS[1]))
}
{
  const { f, calls } = fakeFetch([
    error(400, { error: { message: 'Invalid JSON payload: unknown field responseSchema' } }), reply(wiseway, true),
  ])
  const r = await scanReceipt('K', image, ctx, f)
  const second = JSON.parse(String(calls[1].init.body)) as { generationConfig: Record<string, unknown> }
  check('a turned-down schema asks again without it', r.total === 123.64 && !second.generationConfig.responseSchema
    && second.generationConfig.responseMimeType === 'application/json')
}

{
  const first = JSON.parse(String(fakeFetch([]).f && JSON.stringify(scanRequestBody(image, ctx)))) as
    { generationConfig: { thinkingConfig?: { thinkingBudget: number } } }
  check('thinking is turned off, so the answer comes quickly', first.generationConfig.thinkingConfig?.thinkingBudget === 0)
  const { f, calls } = fakeFetch([
    error(400, { error: { message: 'Thinking budget 0 is not supported for this model.' } }), reply(wiseway),
  ])
  const r = await scanReceipt('K', image, ctx, f)
  const second = JSON.parse(String(calls[1].init.body)) as { generationConfig: Record<string, unknown> }
  check('a model that will not stop thinking is asked again without it',
    r.total === 123.64 && !second.generationConfig.thinkingConfig && !!second.generationConfig.responseSchema)
}

console.log('\nWhich models: the ones this key has, not names guessed in advance')
const listed = [
  { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-3-flash-preview-11-2026', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
]
const picked = pickScanModels(listed)
check('newest stable Flash first, then a Flash-Lite, then the next Flash',
  picked.join() === 'gemini-3-flash,gemini-2.5-flash-lite,gemini-2.5-flash', picked.join())
check('never an image, speech, Pro or embedding model, nor the alias that hung',
  !picked.some((m) => /image|tts|pro|embedding|latest/.test(m)))
check('an empty list picks nothing (and the built-in names are used)', pickScanModels([]).length === 0)
{
  const { f, calls } = fakeFetch([reply(wiseway)], listed)
  await scanReceipt('K', image, ctx, f)
  check('a scan uses the first model from the key\'s own list', calls[0].url.includes('/models/gemini-3-flash:'))
}
{
  const timeout = () => Object.assign(new Error('Fetch is aborted'), { name: 'AbortError' })
  const { f, calls } = fakeFetch([timeout(), reply(wiseway)], listed)
  const r = await scanReceipt('K', image, ctx, f, 5)
  check('a model that hangs is left for the next', r.total === 123.64 && calls[1].url.includes('gemini-2.5-flash-lite'))
  const all = fakeFetch([timeout(), timeout(), timeout()], listed)
  const e = await fails_with(scanReceipt('K', image, ctx, all.f, 5))
  check('all of them hanging says so, naming each and how long it waited',
    e?.reason === 'slow' && /gemini-3-flash \d+s/.test(e.detail) && /in all/.test(e.detail), e?.detail)
}

console.log('\nChecking a key costs nothing')
{
  const { f, calls } = fakeFetch([new Response('{}', { status: 200 }), error(400, { error: { message: 'API key not valid' } })])
  check('a good key', await checkScanKey('GOOD', f) === true)
  check('a bad key', await checkScanKey('BAD', f) === false)
  check('by listing models, not by reading a receipt', calls.every((c) => c.url.includes('/models?') && !c.init.body))
}

console.log('\nFrom a scan to the Buy sheet')
const storesUsed = [{ name: "Lowe's", count: 9 }, { name: 'Tractor Supply Co', count: 3 }]
const base = { store: null, date: null, total: null, kind: null, forSpecies: null, items: [] }
const fill = (r: Partial<typeof base> & Record<string, unknown>) =>
  quickFillFromScan({ ...base, ...r } as never, { quickKinds: QUICK_KINDS, stores: storesUsed })
check('a store read as LOWES is the farm\'s Lowe\'s', fill({ store: 'LOWES' }).supplier === "Lowe's", fill({ store: 'LOWES' }).supplier)
check('a new store is kept as read', fill({ store: 'Rural King' }).supplier === 'Rural King')
check('the total, to the cent', fill({ total: 612.4 }).cost === '612.40')
check('a quick kind is tapped', fill({ kind: 'Building supplies' }).kind === 'Building supplies'
  && !fill({ kind: 'Building supplies' }).moreKinds)
check('any other kind opens "Something else"', fill({ kind: 'Improvements' }).moreKinds)
check('feed for pigs comes with its animal', fill({ kind: 'Feed', forSpecies: 'Pig' }).forSpecies === 'Pig')
check('lumber does not, whatever was read', fill({ kind: 'Building supplies', forSpecies: 'Pig' }).forSpecies === '')
check('nothing read leaves the form blank', JSON.stringify(fill({})) ===
  JSON.stringify({ cost: '', kind: '', moreKinds: false, forSpecies: '', supplier: '', date: '' }))

console.log('\nA mixed receipt, split by kind')
const mixed = {
  ...base, total: 108.07, kind: 'Feed', forSpecies: 'Pig',
  items: [
    { description: 'Hog grower 50 lb', amount: 18.99, kind: 'Feed' },
    { description: 'Hog grower 50 lb', amount: 18.99, kind: 'Feed' },
    { description: 'Water heater element', amount: 62.0, kind: 'Parts' },
    { description: 'Mystery line', amount: 0.5, kind: null },
  ],
}
check('two kinds is mixed', isMixed(mixed))
check('one kind is not', !isMixed({ ...mixed, items: mixed.items.slice(0, 2) }))
const lines = linesFromScan(mixed)
check('one line per kind, the bigger first', lines.map((l) => l.material).join() === 'Parts,Feed', JSON.stringify(lines))
check('named the way the quick sheet names them', lines[1].name === 'Pig feed' && lines[1].category === 'Pig')
const cents = lines.reduce((t, l) => t + Math.round(Number(l.cost) * 100), 0)
check('they add up to what was paid, tax and all, to the cent', cents === 10807, String(cents))
check('an unread item goes with the receipt\'s own kind',
  Math.abs(Number(lines[1].cost) - 108.07 * (38.48 / 100.48)) < 0.02, lines[1].cost)

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
