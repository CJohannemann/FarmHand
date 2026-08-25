// selectSince() answers "updated_at > $1 order by updated_at asc" — and a
// group and the dozen members createGroupWithMembers() writes in the same
// batch can easily land with identical updated_at timestamps, which gives
// Postgres no reason to prefer one order over the other. A member's row
// landing ahead of its group's the moment a brand new device pulls a whole
// farm for the first time trips the asset table's own parent_id foreign
// key — this drives pull() with a stand-in server that deliberately hands a
// child back before its parent, so the ordering pull() is responsible for
// is checked directly instead of relying on some real engine's incidental
// scan order (which is what let the equivalent push() bug regress unnoticed
// in the first place — see verify-push-order.ts).
//
//   npm run verify:pull-order
import { pull, type Local, type Remote, type Row } from '../../src/lib/syncCore.ts'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

function makeLocal(upserted: { table: string; id: string }[]): Local {
  return {
    async query<T = Row>(sql: string, params: unknown[] = []) {
      const m = sql.match(/^insert into "(\w+)"/)
      if (m) upserted.push({ table: m[1], id: String(params[0]) })
      return { rows: [] as T[] }
    },
    async applying<T>(fn: () => Promise<T>) { return fn() },
    async getState() { return null },
    async setState() {},
  }
}

function makeRemote(assetRowsInServerOrder: Row[]): Remote {
  return {
    async upsert() {},
    async selectSince(table, since) {
      // Called once per table pull() iterates; only 'asset' has anything to
      // give back, and only on the first call for it (since >= last means
      // "nothing new" on the second pass through the loop).
      if (table !== 'asset' || since !== '1969-12-31T23:59:00.000Z') return []
      return assetRowsInServerOrder
    },
    async selectLogAssets() { return [] },
  }
}

console.log('\nA pulled page hands a member back ahead of its group')
{
  const group: Row = {
    id: 'group-1', type: 'group', name: 'Beef cattle', parent_id: null,
    updated_at: '2026-01-01T00:00:00Z',
  }
  const member: Row = {
    id: 'member-1', type: 'animal', name: 'Beef cattle 1', parent_id: 'group-1',
    updated_at: '2026-01-01T00:00:00Z',
  }
  const upserted: { table: string; id: string }[] = []
  await pull(makeLocal(upserted), makeRemote([member, group]))

  const assetUpserts = upserted.filter((u) => u.table === 'asset')
  const groupIdx = assetUpserts.findIndex((u) => u.id === 'group-1')
  const memberIdx = assetUpserts.findIndex((u) => u.id === 'member-1')
  check('both rows were upserted locally', groupIdx !== -1 && memberIdx !== -1)
  check('the group was upserted ahead of its member despite the server order',
    groupIdx < memberIdx, `group@${groupIdx} member@${memberIdx}`)
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} FAILED\n`)
process.exit(fails ? 1 : 0)
