import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAssets, logYears, recentLogs } from '../db/queries'
import type { Asset, LogWithDetail } from '../db/types'
import { idsForAnimalFilter, logMatchesAnimal, SPECIES_FILTER } from '../lib/animalFilter'
import { pluralSpecies } from '../lib/husbandry'
import { useMembersMap } from '../lib/members'
import { LogList, logLabel } from './LogList'
import { EditLog } from './EditLog'

/**
 * The raw log, newest first. Body only — no heading of its own: this used to
 * be its own tab sitting next to Analytics, and the two were the same
 * question ("what has happened here?") answered at two zoom levels. They
 * share one tab now, and Analytics owns the header.
 *
 * Broken up by day and filterable by kind, because on a working farm this is
 * hundreds of rows: a fortnight of feedings alone buries the one purchase
 * someone came here to correct.
 *
 * Filed by year rather than "the most recent N" — a farm logging daily
 * blows past any fixed cap well within its first year, and a flat "last 200"
 * would make last year's records simply unreachable once this year's
 * activity pushed them out. Same year picker Past Stock and Receipts already
 * use: only years with something in them, newest first.
 */
export function Records() {
  const [year, setYear] = useState<number | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const years = await logYears()
    // `year` is only ever set by tapping a chip below, so it names a year
    // that already had something in it when the list was built — falling
    // back to the newest year is what makes that list's own top entry (and
    // a farm with no selection yet) mean "this year" rather than nothing.
    const activeYear = year ?? years[0] ?? null
    const logs = activeYear != null ? await recentLogs(5000, undefined, activeYear) : []
    return { years, activeYear, logs }
  }, [year])
  const [editing, setEditing] = useState<LogWithDetail | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const membersById = useMembersMap()
  // Which animal's records — so two pigs' feedings are not a scroll through
  // every flock's. Sold animals stay offered: their history is still here.
  const [animal, setAnimal] = useState('')
  const { data: assets } = useAsync(() => listAssets(['animal', 'group']), [])
  const animals = (assets ?? []).filter((a) => !a.attributes?.external)
  const animalIds = useMemo(() => idsForAnimalFilter(animal, animals), [animal, assets])

  const years = data?.years ?? []
  const activeYear = data?.activeYear ?? null
  const logs = data?.logs ?? []

  // Only the kinds this farm actually has, in the order they last happened —
  // a fixed list of every log type the schema allows would offer filters
  // that match nothing, and alphabetical would bury the common ones.
  // Counted over the picked animal's records only, so a pig's list does not
  // offer a Purchase chip that could only ever come up empty.
  const kinds = useMemo(() => {
    const seen: string[] = []
    for (const l of logs) {
      if (logMatchesAnimal(l.subject_ids, animalIds) && !seen.includes(l.type)) seen.push(l.type)
    }
    return seen
  }, [logs, animalIds])

  // A filter that survives its own kind disappearing: deleting the last
  // purchase while filtered to purchases would otherwise leave an empty
  // list under a chip that is no longer offered. Switching years does the
  // same thing to this same guard for free — a kind picked in one year that
  // the next year never had just clears itself.
  const active = kind && kinds.includes(kind) ? kind : null
  const shown = logs.filter((l) => (!active || l.type === active)
    && logMatchesAnimal(l.subject_ids, animalIds))
  const animalName = animal.startsWith(SPECIES_FILTER)
    ? `all ${pluralSpecies(animal.slice(SPECIES_FILTER.length)).toLowerCase()}`
    : animals.find((a) => a.id === animal)?.name

  return (
    <>
      {/* Worth showing only once there is more than one year to choose
          between — a farm on its first year has nowhere else to go yet. A
          dropdown rather than a chip row: a chip per year reads fine for the
          first few, but keeps growing the list of things above the records
          themselves, which is exactly the screen space this is trying not
          to spend. */}
      <div className="record-filters">
        {years.length > 1 && (
          <select className="year-picker" value={activeYear ?? ''}
            onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {animals.length > 0 && (
          <select className={animal ? 'year-picker on' : 'year-picker'} value={animal}
            aria-label="Which animal" onChange={(e) => setAnimal(e.target.value)}>
            <option value="">All animals</option>
            {animalOptions(animals)}
          </select>
        )}
      </div>

      {/* Worth its own row only once there is more than one kind to choose
          between — a single chip beside "All" is a control with no choice. */}
      {kinds.length > 1 && (
        <div className="chipwrap" style={{ marginBottom: '0.5rem' }}>
          <button className={active === null ? 'chip on' : 'chip'}
            onClick={() => setKind(null)}>
            All
          </button>
          {kinds.map((k) => (
            <button key={k} className={active === k ? 'chip on' : 'chip'}
              onClick={() => setKind(k)}>
              {logLabel(k)}
            </button>
          ))}
        </div>
      )}

      <LogList
        logs={shown}
        loading={loading}
        groupByDate
        onSelect={setEditing}
        membersById={membersById}
        empty={animalName
          ? `Nothing ${active ? logLabel(active).toLowerCase() + ' ' : ''}recorded for ${animalName}${activeYear ? ` in ${activeYear}` : ''}.`
          : active
            ? `No ${logLabel(active).toLowerCase()} records yet.`
            : 'Nothing recorded yet.'}
      />

      {editing && (
        <EditLog
          log={editing}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); reload() }}
        />
      )}
    </>
  )
}

/**
 * One <optgroup> per species: the whole species first, then any groups (a
 * pen fed as one), then each animal — those still here before those gone.
 */
function animalOptions(animals: Asset[]) {
  const bySpecies = new Map<string, Asset[]>()
  for (const a of animals) {
    const sp = String(a.attributes?.species ?? '').trim() || 'Other'
    const list = bySpecies.get(sp)
    if (list) list.push(a); else bySpecies.set(sp, [a])
  }
  const rank = (a: Asset) => (a.type === 'group' ? 0 : 1) + (a.status === 'active' ? 0 : 2)
  return [...bySpecies].sort(([a], [b]) => a.localeCompare(b)).map(([sp, list]) => (
    <optgroup key={sp} label={sp === 'Other' ? 'Other' : pluralSpecies(sp)}>
      {sp !== 'Other' && list.length > 1 && (
        <option value={SPECIES_FILTER + sp}>All {pluralSpecies(sp).toLowerCase()}</option>
      )}
      {[...list]
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}{a.type === 'group' ? ' (group)' : ''}{a.status === 'active' ? '' : ' (gone)'}
          </option>
        ))}
    </optgroup>
  ))
}
