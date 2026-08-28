// The double-submit guard in src/lib/useSave.ts.
//
// Found in the field, not in review: closing out a pig recorded "got meat"
// three times, because the save is several awaits long, feels unresponsive
// on a phone, and nothing stopped a second press starting a second save.
//
// The hook is exercised through its own logic rather than through React,
// since what is being tested is the synchronous ref guard — the part that
// makes two presses in the SAME tick collapse into one. A `busy` state
// variable cannot do that: React batches updates, so both presses would read
// busy === false and both proceed.
//
//   npm run verify:double-submit

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

/** The guard, exactly as useSave implements it, minus React's useState/useRef. */
function makeGuarded(action: () => Promise<void>) {
  const inFlight = { current: false }
  let busy = false
  let error: string | null = null
  const run = async () => {
    if (inFlight.current) return
    inFlight.current = true
    busy = true
    error = null
    try { await action() } catch (e) { error = (e as Error).message || 'Saving failed.' }
    finally { inFlight.current = false; busy = false }
  }
  return { run, get busy() { return busy }, get error() { return error } }
}

console.log('\nAn impatient triple-press writes one record')
let writes = 0
const slowSave = async () => {
  await new Promise((r) => setTimeout(r, 30))
  writes++
}
const g = makeGuarded(slowSave)
// All three fired before the first resolves — the real barn scenario.
await Promise.all([g.run(), g.run(), g.run()])
check('three presses, one record', writes === 1, `${writes} writes`)

console.log('\nPressing again after it finishes still works')
await g.run()
check('a genuine second save is not blocked', writes === 2, `${writes} writes`)

console.log('\nA failure is reported, not swallowed')
const bad = makeGuarded(async () => { throw new Error('the database is offline') })
await bad.run()
check('the error is captured', bad.error === 'the database is offline', String(bad.error))
check('and it is not left busy', bad.busy === false)

console.log('\nAfter a failure the button works again')
let retried = 0
const flaky = makeGuarded(async () => { retried++; if (retried === 1) throw new Error('nope') })
await flaky.run()
await flaky.run()
check('a retry runs', retried === 2, `${retried} attempts`)
check('and clears the earlier error', flaky.error === null, String(flaky.error))

console.log('\nAn error with no message still says something')
const mute = makeGuarded(async () => { throw new Error('') })
await mute.run()
check('falls back to a readable message', mute.error === 'Saving failed.', String(mute.error))

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
