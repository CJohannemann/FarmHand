import { useState } from 'react'
import { completeTask } from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { speciesGlyph } from '../lib/husbandry'

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** When a chore is due, in the words a farm would use — and whether it's late. */
export function dueText(iso: string): { text: string; late: boolean } {
  const when = new Date(iso)
  const days = Math.round((when.getTime() - startOfToday().getTime()) / 86_400_000)
  if (days < 0) return { text: days === -1 ? 'yesterday' : `${-days} days ago`, late: true }
  if (days === 0) return { text: 'today', late: false }
  if (days === 1) return { text: 'tomorrow', late: false }
  if (days < 7) return { text: `in ${days} days`, late: false }
  return {
    text: when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    late: false,
  }
}

/** A birth the farm is expecting soon — see Today's own `births`. */
export interface BirthRow {
  assetId: string
  species: string | null
  /** "Sadie due to farrow" — already in the words this species uses. */
  title: string
  /** "Jan 2 · in 12 days", plus the sire where one was recorded. */
  when: string
  late: boolean
}

/**
 * The farm's chore list: one tick to say it's done, or tap the chore itself
 * to open everything else about it.
 *
 * Births due share the list rather than getting a section of their own —
 * "a heifer calves a week Tuesday" belongs in the same glance as "worm the
 * cattle", and a second list would be a second place to forget to look.
 * They sit at the top whatever their date, because they are the only rows
 * here nobody chose to put on the list and the only ones that cannot be
 * rescheduled. They carry no tick: a birth isn't done by ticking it, it's
 * done by recording what was born, which is what tapping through to the
 * animal is for.
 *
 * The row used to carry its own ✕ to drop a chore. Now that the body opens
 * a sheet, a destructive control sat one thumb-width from a tappable row —
 * so dropping a chore moved inside that sheet, behind its own confirm.
 * Ticking stayed out here: it's the thing done most often, it's not
 * destructive, and it's the whole reason the list exists.
 */
export function TaskList({
  tasks, births = [], onChanged, onOpen, onOpenAnimal,
}: {
  tasks: LogWithDetail[]
  births?: BirthRow[]
  onChanged: () => void
  onOpen: (task: LogWithDetail) => void
  onOpenAnimal?: (assetId: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  if (tasks.length === 0 && births.length === 0) return null

  const tick = async (id: string) => {
    setBusy(id)
    await completeTask(id)
    setBusy(null)
    onChanged()
  }

  return (
    <ul className="tasklist">
      {births.map((b) => (
        <li key={b.assetId} className={b.late ? 'late' : ''}>
          <span className="task-glyph" aria-hidden="true">{speciesGlyph(b.species)}</span>
          <button className="task-body" onClick={() => onOpenAnimal?.(b.assetId)}>
            <span className="task-name">{b.title}</span>
            <span className="task-when">{b.when}</span>
          </button>
          <span className="chev" aria-hidden="true">›</span>
        </li>
      ))}
      {tasks.map((t) => {
        const d = dueText(t.timestamp)
        return (
          <li key={t.id} className={d.late ? 'late' : ''}>
            <button
              className="tick"
              aria-label={`Mark ${t.name ?? 'chore'} done`}
              disabled={busy === t.id}
              onClick={() => tick(t.id)}
            >
              ○
            </button>
            <button className="task-body" onClick={() => onOpen(t)}>
              <span className="task-name">{t.name}</span>
              <span className="task-when">
                {d.text}{t.subjects ? ` · ${t.subjects}` : ''}
                {t.notes ? ' · has details' : ''}
              </span>
            </button>
            <span className="chev" aria-hidden="true">›</span>
          </li>
        )
      })}
    </ul>
  )
}
