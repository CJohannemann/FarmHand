import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  createProject, listProjects, projectPurchases, renameProject, setProjectFinished,
  setPurchasesProject, unassignedPurchases, type Project, type ProjectPurchase,
} from '../db/queries'
import { formatMoney } from '../lib/numeric'
import { byKindAndItem } from '../lib/projectBreakdown'
import { Sheet } from './Sheet'
import { EditLog } from './EditLog'

/**
 * "What did the barn cost?" Purchases are put on a project — on the Buy
 * sheet as they are made, or afterwards with Add purchases here — and the
 * project adds them up: the total, by store, by kind, with each purchase
 * and its receipt a tap away.
 */
export function Projects() {
  const { data: projects, loading, reload } = useAsync(() => listProjects(), [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const open = (projects ?? []).find((p) => p.id === openId)
  if (open) {
    return <ProjectDetail project={open} onBack={() => { setOpenId(null); reload() }}
      onChanged={reload} />
  }

  const add = async () => {
    if (!name.trim()) return
    const id = await createProject(name)
    setName(''); setNaming(false)
    await reload()
    setOpenId(id)
  }

  return (
    <>
      {loading && !projects && <p className="muted">Loading…</p>}

      {projects && projects.length === 0 && !naming && (
        <div className="empty" style={{ marginBottom: '1rem' }}>
          Building a barn, putting up fence, digging a well? Start a project,
          put its purchases on it, and it adds up what it cost.
        </div>
      )}

      {(projects ?? []).length > 0 && (
        <ul className="assetlist">
          {projects!.map((p) => (
            <li key={p.id} className={p.finished ? 'gone' : undefined}>
              <button className="assetrow" onClick={() => setOpenId(p.id)}>
                <span className="asset-name">
                  {p.name}{p.finished ? ' · finished' : ''}
                </span>
                <span className="asset-meta">
                  {formatMoney(p.total)} · {p.purchases} {p.purchases === 1 ? 'purchase' : 'purchases'}
                  <span className="chev">›</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {naming ? (
        <div style={{ marginTop: '1rem' }}>
          <label className="field">
            <span>Project name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              placeholder="Livestock barn" />
          </label>
          <div className="actions">
            <button onClick={() => { setNaming(false); setName('') }}>Cancel</button>
            <button className="primary" disabled={!name.trim()} onClick={add}>Start project</button>
          </div>
        </div>
      ) : (
        <button className="primary" style={{ marginTop: '1rem' }} onClick={() => setNaming(true)}>
          + New project
        </button>
      )}
    </>
  )
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** "Aug 31, 2026 – Nov 10, 2026", or the one date when it all fell on one day. */
const dateSpan = (from: string, to: string) =>
  shortDate(from) === shortDate(to) ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`

/** Sums by a key, largest first, for the By store / By kind breakdowns. */
function breakdown(rows: ProjectPurchase[], key: (r: ProjectPurchase) => string | null) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)?.trim() || 'Not recorded'
    m.set(k, (m.get(k) ?? 0) + (r.price ?? 0))
  }
  return [...m].sort((a, b) => b[1] - a[1])
}

function ProjectDetail({ project, onBack, onChanged }: {
  project: Project; onBack: () => void; onChanged: () => void
}) {
  const { data: rows, reload } = useAsync(() => projectPurchases(project.id), [project.id])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ProjectPurchase | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)

  const list = rows ?? []
  const total = list.reduce((t, r) => t + (r.price ?? 0), 0)
  const byStore = useMemo(() => breakdown(list, (r) => r.supplier), [rows])
  const byKind = useMemo(() => byKindAndItem(list), [rows])
  const refresh = () => { reload(); onChanged() }

  return (
    <>
      <button className="back" onClick={onBack}>‹ All projects</button>

      {renaming ? (
        <div>
          <label className="field">
            <span>Project name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="actions">
            <button onClick={() => { setRenaming(false); setName(project.name) }}>Cancel</button>
            <button className="primary" disabled={!name.trim()} onClick={async () => {
              await renameProject(project.id, name); setRenaming(false); onChanged()
            }}>Save</button>
          </div>
        </div>
      ) : (
        <h2 className="project-title">{project.name}{project.finished ? ' · finished' : ''}</h2>
      )}

      <div className="netpanel">
        <span className="netpanel-value">{formatMoney(total)}</span>
        <span className="netpanel-label">
          {list.length} {list.length === 1 ? 'purchase' : 'purchases'}
          {list.length > 0 ? ` · ${dateSpan(list[list.length - 1].timestamp, list[0].timestamp)}` : ''}
        </span>
      </div>

      <button className="primary" style={{ marginTop: '1rem' }} onClick={() => setAdding(true)}>
        + Add purchases
      </button>

      {list.length === 0 && (
        <p className="hint">
          Nothing on it yet. Add purchases you've already made, or pick this
          project on the Buy sheet next time you buy something for it.
        </p>
      )}

      {byStore.length > 1 && (
        <>
          <h2 className="section">By store</h2>
          <div className="costbox">
            {byStore.map(([k, v]) => (
              <div className="costrow" key={k}><span>{k}</span><span>{formatMoney(v)}</span></div>
            ))}
          </div>
        </>
      )}
      {list.length > 0 && (
        <>
          <h2 className="section">What was bought</h2>
          <div className="costbox">
            {byKind.map((g) => (
              <div key={g.kind}>
                <div className="costrow kindrow"><span>{g.kind}</span><span>{formatMoney(g.total)}</span></div>
                {g.items.map(([label, v]) => (
                  <div className="costrow itemrow" key={label}><span>{label}</span><span>{formatMoney(v)}</span></div>
                ))}
              </div>
            ))}
          </div>
          {byKind.some((g) => g.items.some(([l]) => l.startsWith('From ') || l === 'Not named')) && (
            <p className="hint">Tap a purchase below to say what it was.</p>
          )}
        </>
      )}

      {list.length > 0 && (
        <>
          <h2 className="section">Purchases</h2>
          <ul className="loglist">
            {list.map((r) => (
              <li key={r.logId}>
                <button className="logrow" onClick={() => setEditing(r)}>
                  <div className="log-main">
                    <span className="log-type">
                      {r.name ?? 'Purchase'}
                      {r.hasReceipt && <span role="img" aria-label="has a receipt"> 🧾</span>}
                    </span>
                    {r.price != null && <span className="log-qty">{formatMoney(r.price)}</span>}
                  </div>
                  <div className="log-sub">
                    {[shortDate(r.timestamp), r.supplier].filter(Boolean).join(' · ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions" style={{ marginTop: '1.5rem' }}>
        {!renaming && <button onClick={() => setRenaming(true)}>Rename</button>}
        <button onClick={async () => { await setProjectFinished(project.id, !project.finished); onChanged() }}>
          {project.finished ? 'Reopen project' : 'Mark finished'}
        </button>
      </div>
      {!project.finished && (
        <p className="hint">
          Finished projects keep their purchases and total; they just stop
          being offered on the Buy sheet.
        </p>
      )}

      {adding && (
        <AddPurchases projectId={project.id} onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); refresh() }} />
      )}
      {editing && (
        <EditLog
          log={{ id: editing.logId, name: editing.name, notes: editing.notes,
            timestamp: editing.timestamp, type: 'purchase' }}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); refresh() }}
        />
      )}
    </>
  )
}

/**
 * Ticking off purchases already made — the barn half bought before the
 * project existed. Only purchases on no project are offered; one already
 * on another project is moved from its own record (Records → the purchase).
 */
function AddPurchases({ projectId, onClose, onDone }: {
  projectId: string; onClose: () => void; onDone: () => void
}) {
  const { data: rows, loading } = useAsync(() => unassignedPurchases(), [])
  const [picked, setPicked] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const q = search.trim().toLowerCase()
  const shown = (rows ?? []).filter((r) => !q
    || [r.name, r.supplier, r.material, r.notes].some((s) => s?.toLowerCase().includes(q)))
  const sum = (rows ?? []).filter((r) => picked.includes(r.logId))
    .reduce((t, r) => t + (r.price ?? 0), 0)
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <Sheet title="Add purchases" onClose={onClose}>
      <label className="field">
        <span>Find</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Store, item, or kind — Wiseway, lumber…" />
      </label>
      {loading && !rows && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="hint">Every purchase is already on a project.</p>
      )}
      <ul className="picklist">
        {shown.map((r) => (
          <li key={r.logId}>
            <label className={picked.includes(r.logId) ? 'pickrow on' : 'pickrow'}>
              <input type="checkbox" checked={picked.includes(r.logId)}
                onChange={() => toggle(r.logId)} />
              <span className="pick-main">
                <span>{r.name ?? 'Purchase'}{r.hasReceipt ? ' 🧾' : ''}</span>
                <small className="muted">
                  {[shortDate(r.timestamp), r.supplier, r.material].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="pick-amount">{r.price != null ? formatMoney(r.price) : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="primary" disabled={busy || picked.length === 0} onClick={async () => {
        setBusy(true)
        await setPurchasesProject(picked, projectId)
        setBusy(false)
        onDone()
      }}>
        {picked.length === 0 ? 'Tick the purchases to add'
          : `Add ${picked.length} ${picked.length === 1 ? 'purchase' : 'purchases'} · ${formatMoney(sum)}`}
      </button>
    </Sheet>
  )
}
