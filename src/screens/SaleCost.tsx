import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  listAssets, pendingWeightSales, saleCostInputs, saleSummary, weightHistory,
} from '../db/queries'
import { saleCosts, type AnimalCost } from '../lib/saleCost'
import { pluralSpecies } from '../lib/husbandry'
import {
  formatMoney, formatQty, ignoreArrowKeysOnNumberInput, ignoreScrollOnNumberInput, onNumericChange,
} from '../lib/numeric'

/**
 * "What do I charge for these two pigs?" Pick the species, tap the animals
 * being sold, and read off what each cost to raise — bought for, the feed
 * logged to it, its share of the marked feed nobody logged, and vet and
 * other inputs. A markup turns that into a price. See lib/saleCost.ts for
 * how the feed is split; equipment is left out.
 *
 * Only animals still on the farm are offered: this is for pricing a sale
 * before it happens. A sold one's figures stay on its own page.
 */
export function SaleCost() {
  const { data: assets } = useAsync(() => listAssets(['animal']), [])
  const speciesList = useMemo(() => {
    const seen = new Set<string>()
    for (const a of assets ?? []) {
      const s = String(a.attributes?.species ?? '').trim()
      if (s && a.status === 'active' && !a.attributes?.external) seen.add(s)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [assets])

  const [picked, setPicked] = useState<string | null>(null)
  // A farm with one species has nothing to choose between.
  const species = picked && speciesList.includes(picked) ? picked : speciesList[0] ?? null

  if (!assets) return <p className="muted">Loading…</p>
  if (!species) {
    return (
      <div className="empty" style={{ marginTop: '1rem' }}>
        No animals on the farm yet — add them on Inventory, then come back here
        to price them.
      </div>
    )
  }

  return (
    <>
      {speciesList.length > 1 && (
        <div className="chipwrap" style={{ marginBottom: '0.75rem' }}>
          {speciesList.map((s) => (
            <button key={s} className={s === species ? 'chip on' : 'chip'}
              onClick={() => setPicked(s)}>
              {pluralSpecies(s)}
            </button>
          ))}
        </div>
      )}
      {/* Keyed so switching species starts a fresh selection rather than
          carrying ids that belong to the other one. */}
      <SpeciesCost key={species} species={species} />
    </>
  )
}

function SpeciesCost({ species }: { species: string }) {
  const { data, loading } = useAsync(async () => {
    const inputs = await saleCostInputs(species)
    // Sold by hanging weight and gone to the butcher, but not priced yet —
    // the moment this screen is most needed for that animal.
    const awaiting = new Set((await pendingWeightSales()).flatMap((w) => w.assetIds))
    return { inputs, awaiting, result: saleCosts(species, inputs.animals, inputs.rows, inputs.lots) }
  }, [species])
  const [selected, setSelected] = useState<string[]>([])
  const [markup, setMarkup] = useState('')

  const here = (data?.inputs.animals ?? [])
    // Still here, waiting on a butcher's weight, or sold in the last two
    // months — long enough to see what the last ones made when pricing
    // the next.
    .filter((a) => a.left == null || data?.awaiting.has(a.id)
      || Date.now() - new Date(a.left).getTime() < 60 * 24 * 60 * 60 * 1000)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const chosen = here.filter((a) => selected.includes(a.id))
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  if (loading && !data) return <p className="muted">Loading…</p>
  if (!data) return null
  const { result } = data
  const plural = pluralSpecies(species).toLowerCase()
  const pct = Number(markup) > 0 ? Number(markup) : 0

  return (
    <>
      <h2 className="section">Which {plural} are you selling?</h2>
      {here.length === 0 ? (
        <p className="hint">No {plural} on the farm right now.</p>
      ) : (
        <div className="chipwrap" style={{ marginBottom: '0.5rem' }}>
          {here.map((a) => (
            <button key={a.id} className={selected.includes(a.id) ? 'chip on' : 'chip'}
              onClick={() => toggle(a.id)}>
              {a.name}{a.left != null ? ' · sold' : ''}
            </button>
          ))}
        </div>
      )}

      {result.markedCount === 0 && (
        <p className="hint warn">
          No feed purchases are marked for {plural} yet, so only feed logged at
          a feeding is counted. Open a feed purchase in Records and set
          “For” to {species} so the rest counts too.
        </p>
      )}

      {chosen.length > 0 && (
        <>
          <label className="field">
            <span>Markup (%, optional)</span>
            <input type="number" inputMode="decimal" min="0" value={markup}
              onChange={onNumericChange(setMarkup)} onWheel={ignoreScrollOnNumberInput}
              onKeyDown={ignoreArrowKeysOnNumberInput} placeholder="25" />
          </label>

          {chosen.map((a) => (
            <AnimalPrice key={a.id} id={a.id} name={a.name}
              cost={result.byAnimal.get(a.id)!} markup={pct} />
          ))}

          {chosen.length > 1 && (
            <>
              <h2 className="section">
                {chosen.length === 2 ? 'Both together' : `All ${chosen.length} together`}
              </h2>
              <div className="costbox">
                <Row label="Cost to raise"
                  value={formatMoney(sum(chosen.map((a) => result.byAnimal.get(a.id)!.total)))} />
                {pct > 0 && (
                  <Row strong label={`Price at ${pct}% markup`}
                    value={formatMoney(sum(chosen.map((a) =>
                      result.byAnimal.get(a.id)!.total)) * (1 + pct / 100))} />
                )}
              </div>
            </>
          )}
        </>
      )}

      <h2 className="section">How this is worked out</h2>
      <p className="hint">
        Feed logged at a feeding goes to the animals that ate it. Feed marked
        “For: {species}” that was never logged is split evenly across the{' '}
        {plural} on the farm the day it was bought — or the next ones to arrive,
        if it was bought ahead of them. Equipment isn’t counted.
      </p>
      {result.markedCount > 0 && (
        <p className="hint">
          {result.markedCount} marked purchase{result.markedCount === 1 ? '' : 's'},{' '}
          {formatMoney(result.markedSpend)} in all.
          {result.unassigned > 0.005 && (
            <> {formatMoney(result.unassigned)} of it was bought with no {plural} on
              the farm before or after, so it isn’t charged to any.</>
          )}
        </p>
      )}
    </>
  )
}

function AnimalPrice({ id, name, cost, markup }: {
  id: string; name: string; cost: AnimalCost; markup: number
}) {
  const { data: weights } = useAsync(() => weightHistory(id), [id])
  const { data: sale } = useAsync(() => saleSummary(id), [id])
  const latest = weights && weights.length > 0 ? weights[weights.length - 1] : null
  const price = cost.total * (1 + markup / 100)
  const profit = sale && sale.income > 0 ? sale.income - cost.total : null
  return (
    <>
      <h2 className="section">{name}</h2>
      <div className="costbox">
        <Row label="Bought for" value={formatMoney(cost.bought)} />
        <Row label="Feed logged to it" value={formatMoney(cost.feedLogged)} />
        <Row label="Share of other marked feed" value={formatMoney(cost.feedShared)} />
        <Row label="Vet & other" value={formatMoney(cost.other)} />
        <Row strong label="Cost to raise" value={formatMoney(cost.total)} />
        {latest && latest.value > 0 && (
          <Row label={`Per ${latest.unit} (at ${latest.value} ${latest.unit})`}
            value={formatMoney(cost.total / latest.value)} />
        )}
        {markup > 0 && !sale?.sold && (
          <Row strong label={`Price at ${markup}% markup`} value={formatMoney(price)} />
        )}
        {/* Once it has sold, what it actually fetched replaces the guess. */}
        {sale && sale.income > 0 && <Row label="Sold for" value={formatMoney(sale.income)} />}
        {profit != null && (
          <Row strong label={profit >= 0 ? 'Profit' : 'Loss'} value={formatMoney(Math.abs(profit))} />
        )}
        {sale && sale.hangingLb > 0 && (
          <Row label={`Cost per hanging lb (${formatQty(sale.hangingLb)} lb)`}
            value={formatMoney(cost.total / sale.hangingLb)} />
        )}
      </div>
    </>
  )
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'costrow strong' : 'costrow'}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}
