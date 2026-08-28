import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { closedOutStock, type ClosedOutAsset } from '../db/queries'
import { formatMoney, formatQty } from '../lib/numeric'
import { speciesGlyph } from '../lib/husbandry'

/**
 * What the farm ran in a given year, and what became of it.
 *
 * Inventory is present tense: a species with nothing left stops appearing
 * there, because a pig icon over "0 animals" tells someone they have pigs
 * when the last one went to the sale barn in October. The records still
 * exist — deletes here are soft — and this is where they are read.
 *
 * A season summary rather than a filtered list, because by the time someone
 * has picked a year the interesting question is not "which animals" but
 * "what did the year come to". Sold, died and processed are three different
 * outcomes and only one of them is income; keeping them apart is the
 * difference between a report and a row count.
 */
export function PastStock() {
  const { data, loading } = useAsync(() => closedOutStock(), [])
  const [year, setYear] = useState<number | null>(null)
  const [openSpecies, setOpenSpecies] = useState<string | null>(null)

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const a of data ?? []) {
      const y = Number(a.leftAt.slice(0, 4))
      if (Number.isFinite(y)) set.add(y)
    }
    return [...set].sort((a, b) => b - a)
  }, [data])

  // Default to the most recent year that has anything in it, rather than
  // this calendar year — in January the useful view is still last season.
  const activeYear = year ?? years[0] ?? null

  const bySpecies = useMemo(() => {
    if (!data || activeYear == null) return []
    const groups = new Map<string, ClosedOutAsset[]>()
    for (const a of data) {
      if (Number(a.leftAt.slice(0, 4)) !== activeYear) continue
      const key = a.species ?? 'No species set'
      const list = groups.get(key)
      if (list) list.push(a)
      else groups.set(key, [a])
    }
    return [...groups.entries()]
      .map(([species, items]) => ({ species, items }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [data, activeYear])

  if (loading) return <p className="muted">Loading…</p>

  if (!data?.length) {
    return (
      <p className="muted">
        Nothing has left the farm yet. Animals you sell, butcher or lose show
        up here, filed by the year they went.
      </p>
    )
  }

  return (
    <>
      <div className="chipwrap">
        {years.map((y) => (
          <button key={y} className={y === activeYear ? 'chip on' : 'chip'}
            onClick={() => { setYear(y); setOpenSpecies(null) }}>
            {y}
          </button>
        ))}
      </div>

      {bySpecies.map(({ species, items }) => {
        const income = items.reduce((n, a) => n + a.income, 0)
        const open = openSpecies === species
        // Grouped by outcome rather than listed flat: "94 sold, 3 died, 3
        // processed" is the shape of the answer someone is after.
        const outcomes = new Map<string, number>()
        for (const a of items) {
          const k = a.outcome ?? 'closed out'
          outcomes.set(k, (outcomes.get(k) ?? 0) + 1)
        }

        return (
          <section key={species} className="paststock">
            <button className="paststock-head"
              onClick={() => setOpenSpecies(open ? null : species)}
              aria-expanded={open}>
              <span className="glyph">{speciesGlyph(species === 'No species set' ? null : species)}</span>
              <span className="paststock-name">{species}</span>
              <span className="muted">
                {formatQty(items.length)} closed out
              </span>
              <span className="paststock-chevron">{open ? '▾' : '▸'}</span>
            </button>

            <div className="paststock-summary">
              {[...outcomes.entries()].map(([outcome, n]) => (
                <span key={outcome} className="paststock-outcome">
                  {outcome} {formatQty(n)}
                </span>
              ))}
              {income > 0 && (
                <span className="paststock-income net-up">{formatMoney(income)}</span>
              )}
            </div>

            {open && (
              <ul className="assetlist">
                {items.map((a) => (
                  <li key={a.id} className="gone">
                    <span className="assetrow static">
                      <span className="asset-name">{a.name}</span>
                      <span className="asset-meta">
                        {a.outcome ?? 'closed out'}
                        {a.income > 0 ? ` · ${formatMoney(a.income)}` : ''}
                        {' · '}
                        {new Date(a.leftAt).toLocaleDateString(undefined,
                          { month: 'short', day: 'numeric' })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}
