// A project's spending by kind and, inside each kind, by what was bought.
//
//   npm run verify:project-breakdown
import { byKindAndItem, itemLabel } from '../../src/lib/projectBreakdown.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

// The Livestock Barn as it stood: gates and wire named, one Lowe's order
// named only by its kind, and a power bill.
const barn = [
  { material: 'Building supplies', item: 'gates', supplier: 'TSC', price: 259.98 },
  { material: 'Building supplies', item: 'Building supplies', supplier: "Lowe's", price: 1583.34 },
  { material: 'Building supplies', item: 'Electric wire', supplier: 'Amazon', price: 251.19 },
  { material: 'Building supplies', item: 'Gates', supplier: 'TSC', price: 100 },
  { material: 'Utilities', item: 'Livestock shelter electric', supplier: 'Wiseway', price: 123.64 },
  { material: null, item: null, supplier: null, price: 10 },
  { material: 'Building supplies', item: 'Building supplies', supplier: null, price: null },
]

console.log('\nBy kind, then by item')
const g = byKindAndItem(barn)
check('kinds, largest first', g.map((x) => x.kind).join() === 'Building supplies,Utilities,Not recorded', g.map((x) => x.kind).join())
check('a kind\'s total is all of it, to the cent', g[0].total === 2194.51, String(g[0].total))
const items = Object.fromEntries(g[0].items)
check('a named purchase shows by its name', items['Electric wire'] === 251.19)
check('the same item in a different case is one line', items['gates'] === 359.98 && !('Gates' in items), JSON.stringify(items))
check('one named only by its kind shows by its store', items["From Lowe's"] === 1583.34)
check('with no store either, it is "Not named"', items['Not named'] === 0)
check('items largest first', g[0].items[0][0] === "From Lowe's")
check('the power bill under Utilities', g[1].items[0][0] === 'Livestock shelter electric' && g[1].total === 123.64)
check('a purchase with no kind is under Not recorded', g[2].kind === 'Not recorded' && g[2].items[0][0] === 'Not named')

console.log('\nLabels')
check('kind matched ignoring case', itemLabel({ material: 'Hay', item: 'hay', supplier: 'Co-op', price: 1 }) === 'From Co-op')
check('spaces trimmed', itemLabel({ material: 'Feed', item: '  Pig feed ', supplier: null, price: 1 }) === 'Pig feed')
check('nothing at all is an empty list', byKindAndItem([]).length === 0)

console.log(fails ? `\n${fails} check(s) failed.` : '\nAll checks passed.')
if (fails) process.exit(1)
