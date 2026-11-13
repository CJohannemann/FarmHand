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
  SCAN_MODELS, ScanError, type ScanMemory, checkScanKey, pickScanModels, receiptPrompt, receiptSchema, replyJson, scanReceipt,
  scanRequestBody, scanResultFrom, type ScanContext,
} from '../../src/lib/receiptScan.ts'
import { farmUnit, isMixed, linesFromScan, quickFillFromScan, scanAmount, scanItemName } from '../../src/lib/scanToForm.ts'
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
  const lists = { n: 0 }
  const f = async (url: string, init: RequestInit) => {
    if (url.includes('/models?pageSize=200')) {
      lists.n++
      return models ? new Response(JSON.stringify({ models }), { status: 200 }) : new Response('{}', { status: 404 })
    }
    calls.push({ url, init })
    const a = answers.shift()
    if (!a) throw new Error('no more answers')
    if (a instanceof Error) throw a
    return a
  }
  return { f, calls, lists }
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

// However the model writes the date, it comes back as the same day.
for (const [written, want] of [
  ['2026-11-08', '2026-11-08'], ['2026-11-08T14:32:00', '2026-11-08'], ['2026/11/8', '2026-11-08'],
  ['11/08/2026', '2026-11-08'], ['11/8/26', '2026-11-08'], ['11-08-2026', '2026-11-08'],
  ['Nov 8, 2026', '2026-11-08'], ['November 8 2026', '2026-11-08'], ['Nov. 8th, 2026', '2026-11-08'],
  ['8 Nov 2026', '2026-11-08'], ['Sept 30, 2026', '2026-09-30'],
  ['13/08/2026', null], ['Smarch 8, 2026', null], ['yesterday', null], ['', null],
] as const) {
  check(`date written "${written}"`, scanResultFrom({ date: written }, ctx).date === want)
}
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
  const busy = () => error(503, { error: { status: 'UNAVAILABLE' } })
  const e = await fails_with(scanReceipt('K', image, ctx, fakeFetch(SCAN_MODELS.map(busy)).f))
  check('every model overloaded says try again', e?.reason === 'busy', e?.message)
  const { f, calls } = fakeFetch([busy(), reply(wiseway)])
  const r = await scanReceipt('K', image, ctx, f)
  check('one model overloaded moves on to the next', r.total === 123.64 && calls[1].url.includes(SCAN_MODELS[1]))
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
  const refuse = () => error(400, { error: { message: 'Invalid JSON payload: unknown field responseSchema' } })
  const { f, calls } = fakeFetch([refuse(), refuse(), reply(wiseway, true)])
  const r = await scanReceipt('K', image, ctx, f)
  const third = JSON.parse(String(calls[2].init.body)) as { generationConfig: Record<string, unknown> }
  check('a turned-down schema is left out in the end, same model',
    r.total === 123.64 && !third.generationConfig.responseSchema && calls[2].url === calls[0].url
    && third.generationConfig.responseMimeType === 'application/json')
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
    e?.reason === 'slow' && /gemini-3-flash: no answer in \d+s/.test(e.detail)
    && e.detail.includes('gemini-2.5-flash-lite'), e?.detail)
}

console.log('\nRemembering what worked, so the next scan is quicker')
{
  const vague = () => error(400, { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })
  const mem: ScanMemory = {}
  const first = fakeFetch([vague(), reply(wiseway)], listed)
  await scanReceipt('KEY-ONE', image, ctx, first.f, undefined, mem)
  check('the first scan learns the model and the simpler request that worked',
    mem.model === 'gemini-3-flash' && mem.step === 1 && mem.models?.length === 3, JSON.stringify(mem))
  check('and keeps only the end of the key, not the key', mem.keyEnd === 'EY-ONE' && !JSON.stringify(mem).includes('KEY-ONE'))
  const second = fakeFetch([reply(wiseway)], listed)
  const r = await scanReceipt('KEY-ONE', image, ctx, second.f, undefined, mem)
  const body = JSON.parse(String(second.calls[0].init.body)) as { generationConfig: Record<string, unknown> }
  check('the next scan goes straight to it: one request, no refused first try',
    r.total === 123.64 && second.calls.length === 1 && !body.generationConfig.thinkingConfig, String(second.calls.length))
  check('without asking for the model list again', second.lists.n === 0)

  const busy = () => error(503, { error: { status: 'UNAVAILABLE' } })
  const third = fakeFetch([busy(), reply(wiseway)], listed)
  await scanReceipt('KEY-ONE', image, ctx, third.f, undefined, mem)
  check('when that model is busy, the next one answers and is remembered instead',
    mem.model === 'gemini-2.5-flash-lite' && mem.step === 0, JSON.stringify(mem))

  const other = fakeFetch([reply(wiseway)], listed)
  await scanReceipt('KEY-TWO', image, ctx, other.f, undefined, mem)
  check('a new key starts fresh: the model list is fetched again',
    other.lists.n === 1 && other.calls[0].url.includes('/models/gemini-3-flash:'))

  const down = fakeFetch(Array.from({ length: 9 }, busy), listed)
  await fails_with(scanReceipt('KEY-TWO', image, ctx, down.f, undefined, mem))
  check('when nothing answers, the remembered model is forgotten', mem.model === undefined && mem.step === undefined)
}

console.log('\n"Request contains an invalid argument", naming nothing')
{
  // Exactly the reply the first scan to reach gemini-3.5-flash-lite got.
  const vague = () => error(400, { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })
  const { f, calls } = fakeFetch([vague(), reply(wiseway)])
  const r = await scanReceipt('K', image, ctx, f)
  const second = JSON.parse(String(calls[1].init.body)) as { generationConfig: Record<string, unknown> }
  check('is asked again without the thinking setting, same model',
    r.total === 123.64 && calls[1].url === calls[0].url && !second.generationConfig.thinkingConfig
    && !!second.generationConfig.responseSchema)
  const all = fakeFetch(Array.from({ length: SCAN_MODELS.length * 3 }, vague))
  const e = await fails_with(scanReceipt('K', image, ctx, all.f))
  check('every model and every simpler request turned down: tried them all',
    all.calls.length === SCAN_MODELS.length * 3, String(all.calls.length))
  check('and the detail lists each attempt',
    e?.reason === 'unreadable' && (e.detail.match(/HTTP 400/g) ?? []).length === SCAN_MODELS.length * 3
    && e.detail.includes('without the schema'), e?.detail.slice(0, 160))
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
  JSON.stringify({ cost: '', kind: '', moreKinds: false, forSpecies: '', supplier: '', date: '', name: '', amount: '', unit: '' }))

console.log('\nA scanned purchase is named for what was bought')
{
  const item = (description: string, kind: string | null = 'Parts') => ({ description, amount: 5, kind })
  const parts = (...items: ReturnType<typeof item>[]) => ({ ...base, kind: 'Parts', items }) as never
  check('one part is its own name', fill({ kind: 'Parts', items: [item('Fuel filter')] }).name === 'Fuel filter')
  check('two are both named', scanItemName(parts(item('Fuel filter'), item('Oil filter')), 'Parts')
    === 'Fuel filter and Oil filter')
  check('more than two say how many more', scanItemName(parts(item('Fuel filter'), item('Oil filter'), item('Belt')), 'Parts')
    === 'Fuel filter and 2 more')
  check('the same item twice is one', scanItemName(parts(item('Shear pin'), item('Shear pin')), 'Parts') === 'Shear pin')
  check('an item of no kind read goes with the receipt\'s', scanItemName(parts(item('Grease', null)), 'Parts') === 'Grease')
  check('another kind\'s items do not name it',
    scanItemName(parts(item('Fuel filter'), item('Bolts', 'Building supplies')), 'Parts') === 'Fuel filter')
  check('feed keeps its shared name', fill({ kind: 'Feed', forSpecies: 'Pig', items: [item('Hog grower 50 lb', 'Feed')] }).name === '')
  check('no items read, no name', fill({ kind: 'Parts' }).name === '')
  check('a long one is cut short', scanItemName(parts(item('x'.repeat(80))), 'Parts').length === 60)
}

console.log('\nHow much was bought')
{
  const units = ['lb', 'oz', 'gal', 'qt', 'each', 'Round Bale']
  const it = (description: string, kind: string, quantity: number | null, unit: string | null) =>
    ({ description, amount: 5, kind, quantity, unit })
  const r = (kind: string, ...items: ReturnType<typeof it>[]) => ({ ...base, kind, items }) as never
  check('receipts\' units become the farm\'s', farmUnit('EA', units) === 'each' && farmUnit('Gallons', units) === 'gal'
    && farmUnit('LBS', units) === 'lb' && farmUnit('round bale', units) === 'Round Bale')
  check('a unit the farm does not use is none', farmUnit('bag', units) === null && farmUnit('', units) === null)
  check('two fuel filters and an oil filter are 3 each',
    JSON.stringify(scanAmount(r('Parts', it('Fuel filter', 'Parts', 2, 'ea'), it('Oil filter', 'Parts', 1, 'each')), 'Parts', units))
    === JSON.stringify({ amount: '3', unit: 'each' }))
  check('a part with no count printed is one', scanAmount(r('Parts', it('Belt', 'Parts', null, null)), 'Parts', units)?.amount === '1')
  check('diesel by the gallon', JSON.stringify(scanAmount(r('Fuel', it('Diesel', 'Fuel', 12.5, 'GAL')), 'Fuel', units))
    === JSON.stringify({ amount: '12.5', unit: 'gal' }))
  check('feed with its weight read', JSON.stringify(scanAmount(r('Feed', it('Hog grower', 'Feed', 100, 'lb')), 'Feed', units))
    === JSON.stringify({ amount: '100', unit: 'lb' }))
  check('feed with no weight read is not guessed', scanAmount(r('Feed', it('Hog grower', 'Feed', null, null)), 'Feed', units) === null)
  check('gallons and pounds are not added together',
    scanAmount(r('Medicine', it('Wormer', 'Medicine', 1, 'gal'), it('Salve', 'Medicine', 2, 'lb')), 'Medicine', units) === null)
  check('a unit the farm does not use leaves it blank', scanAmount(r('Parts', it('Chain', 'Parts', 3, 'bag')), 'Parts', units) === null)
  check('another kind\'s items are not counted',
    scanAmount(r('Parts', it('Filter', 'Parts', 1, 'ea'), it('Feed', 'Feed', 50, 'lb')), 'Parts', units)?.amount === '1')
  const f = quickFillFromScan(r('Parts', it('Fuel filter', 'Parts', 1, 'ea')), { quickKinds: QUICK_KINDS, stores: [], units })
  check('the Buy sheet gets it', f.amount === '1' && f.unit === 'each', JSON.stringify(f))
  const lumber = quickFillFromScan(r('Building supplies', it('2x6', 'Building supplies', 12, 'ea')), { quickKinds: QUICK_KINDS, stores: [], units })
  check('but not for building supplies, which are never on hand', lumber.amount === '' && lumber.unit === '')
}

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
