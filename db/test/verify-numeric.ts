// A negative headcount or a negative price is not a typo the app can catch
// later — it corrupts a lot balance or a cost total silently. min="0" does
// not stop a typed or pasted one, so the filter runs on every keystroke and
// this is what proves it.
//
//   npm run verify:numeric
import { sanitizeNumeric } from '../../src/lib/numeric.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}
const eq = (label: string, got: string, want: string) =>
  check(label, got === want, got === want ? '' : `got "${got}", want "${want}"`)

console.log('\nOrdinary numbers pass through untouched')
eq('a whole number', sanitizeNumeric('25'), '25')
eq('a decimal', sanitizeNumeric('12.5'), '12.5')
eq('a price', sanitizeNumeric('340.00'), '340.00')
eq('zero', sanitizeNumeric('0'), '0')

console.log('\nNegatives are stripped')
eq('a typed minus alone', sanitizeNumeric('-'), '')
eq('a negative whole number', sanitizeNumeric('-5'), '5')
eq('a negative decimal', sanitizeNumeric('-12.5'), '12.5')
eq('a minus buried mid-string', sanitizeNumeric('1-2'), '12')
eq('several minuses', sanitizeNumeric('--7'), '7')

console.log('\nA field stays usable while it is being typed')
eq('an empty field can be cleared', sanitizeNumeric(''), '')
eq('a trailing dot survives, en route to 12.5', sanitizeNumeric('12.'), '12.')
eq('a leading dot survives', sanitizeNumeric('.5'), '.5')

console.log('\nJunk and paste accidents')
eq('letters are dropped', sanitizeNumeric('12abc'), '12')
eq('a currency symbol is dropped', sanitizeNumeric('$340'), '340')
eq('a comma-grouped paste', sanitizeNumeric('1,200'), '1200')
eq('whitespace is dropped', sanitizeNumeric(' 25 '), '25')
eq('a second dot is dropped', sanitizeNumeric('1.2.3'), '1.23')
eq('scientific notation cannot sneak a negative in',
  sanitizeNumeric('1e-5'), '15')

console.log('\nInteger fields — headcount has no decimals')
eq('a decimal is flattened', sanitizeNumeric('12.5', { integer: true }), '125')
eq('a negative count', sanitizeNumeric('-8', { integer: true }), '8')
eq('a plain count', sanitizeNumeric('75', { integer: true }), '75')
eq('cleared stays cleared', sanitizeNumeric('', { integer: true }), '')

console.log('\nNothing that survives can parse as negative')
const hostile = [
  '-1', '-0.5', '- 5', '−5', '-1e3', '1-', '--', '-.5', '-0',
  '  -42  ', '$-99', '(-5)', '-1,000',
]
for (const raw of hostile) {
  const out = sanitizeNumeric(raw)
  const n = Number(out)
  check(`"${raw}" cannot yield a negative`,
    out === '' || (Number.isFinite(n) ? n >= 0 : true), `-> "${out}" (${n})`)
}

console.log('\nAnything that survives is a number the database can take')
const samples = ['25', '12.5', '0', '340.00', '', '12.', '.5']
for (const s of samples) {
  const out = sanitizeNumeric(s)
  const ok = out === '' || out === '.' || Number.isFinite(Number(out))
  check(`"${s}" parses cleanly`, ok, `-> "${out}"`)
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
