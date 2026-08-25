// push() re-reads queued rows with `id = any($1::uuid[])`, which makes no
// promise about what order the database hands them back in — on a real
// Postgres asset table, a primary-key index scan sorts by uuid, which has
// no relationship to insertion order. A group pushed in the same batch as
// its own members, with a member's row landing ahead of its group's, trips
// the asset table's own parent_id foreign key the moment Supabase applies
// them. This drives push() with a stand-in database that deliberately hands
// a child back before its parent, so the ordering push() is responsible for
// is checked directly instead of relying on some real engine's incidental
// scan order (which is what let this regress unnoticed in the first place).
//
//   npm run verify:push-order
import { push, type Local, type Remote, type Row } from '../../src/lib/syncCore.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

function makeLocal(queuedIds: string[], assetRowsInDbOrder: Row[]): Local {
  return {
    async query<T = Row>(sql: string, params: unknown[] = []) {
      if (sql.includes('from sync_outbox where tbl')) {
        const rows = params[0] === 'asset' ? queuedIds.map((row_id) => ({ row_id })) : []
        return { rows: rows as unknown as T[] }
      }
      if (sql.startsWith('delete from sync_outbox')) return { rows: [] as T[] }
      if (sql.includes('from "asset" where id')) {
        return { rows: assetRowsInDbOrder as unknown as T[] }
      }
      return { rows: [] as T[] }
    },
    async applying<T>(fn: () => Promise<T>) { return fn() },
    async getState() { return null },
    async setState() {},
  }
}

function makeRemote(pushed: Row[]): Remote {
  return {
    async upsert(table, rows) { if (table === 'asset') pushed.push(...rows) },
    async selectSince() { return [] },
    async selectLogAssets() { return [] },
  }
}

console.log('\nA group pushed alongside its members')
{
  const group: Row = { id: 'group-1', type: 'group', name: 'Beef cattle', parent_id: null }
  const member: Row = {
    id: 'member-1', type: 'animal', name: 'Beef cattle 1', parent_id: 'group-1',
  }
  // The database hands the child back first — exactly what a uuid-ordered
  // index scan would do if member-1's id happens to sort below group-1's.
  const pushed: Row[] = []
  await push(
    makeLocal(['group-1', 'member-1'], [member, group]),
    makeRemote(pushed),
  )
  const groupIdx = pushed.findIndex((r) => r.id === 'group-1')
  const memberIdx = pushed.findIndex((r) => r.id === 'member-1')
  check('both rows reached the server', groupIdx !== -1 && memberIdx !== -1)
  check('the group was pushed ahead of its member despite the db order',
    groupIdx < memberIdx, `group@${groupIdx} member@${memberIdx}`)
}

console.log('\nA grandchild, its parent, and its grandparent, all reversed')
{
  const grandparent: Row = { id: 'a', type: 'group', name: 'Flock', parent_id: null }
  const parent: Row = { id: 'b', type: 'animal', name: 'Flock 1', parent_id: 'a' }
  const child: Row = { id: 'c', type: 'animal', name: 'Flock 1 chick', parent_id: 'b' }
  const pushed: Row[] = []
  await push(
    makeLocal(['a', 'b', 'c'], [child, parent, grandparent]),
    makeRemote(pushed),
  )
  const pos = (id: string) => pushed.findIndex((r) => r.id === id)
  check('grandparent, then parent, then child',
    pos('a') < pos('b') && pos('b') < pos('c'),
    `a@${pos('a')} b@${pos('b')} c@${pos('c')}`)
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
