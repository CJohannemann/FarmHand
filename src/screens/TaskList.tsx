import { useState } from 'react'
import { cancelTask, completeTask } from '../db/queries'
import type { LogWithDetail } from '../db/types'

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function due(iso: string): { text: string; late: boolean } {
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

export function TaskList({
  tasks, onChanged,
}: { tasks: LogWithDetail[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  if (tasks.length === 0) return null

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusy(id)
    await fn(id)
    setBusy(null)
    onChanged()
  }

  return (
    <ul className="tasklist">
      {tasks.map((t) => {
        const d = due(t.timestamp)
        return (
          <li key={t.id} className={d.late ? 'late' : ''}>
            <button
              className="tick"
              aria-label={`Mark ${t.name ?? 'task'} done`}
              disabled={busy === t.id}
              onClick={() => act(t.id, completeTask)}
            >
              ○
            </button>
            <div className="task-body">
              <span className="task-name">{t.name}</span>
              <span className="task-when">
                {d.text}{t.subjects ? ` · ${t.subjects}` : ''}
              </span>
            </div>
            <button
              className="task-drop"
              aria-label="Cancel task"
              disabled={busy === t.id}
              onClick={() => act(t.id, cancelTask)}
            >
              ✕
            </button>
          </li>
        )
      })}
    </ul>
  )
}
