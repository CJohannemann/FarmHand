import { useAsync } from '../lib/useAsync'
import { createProject, listProjects } from '../db/queries'

/** Picked in ProjectSelect to start a project on the spot. */
export const NEW_PROJECT = '__new__'

/**
 * "What project is this for?" on a purchase — a barn, a fence line. Open
 * projects only, plus whichever one the purchase is already on even if it
 * has since been finished, so editing an old purchase does not quietly
 * offer to take it off its project. "New project…" names one right here,
 * created only when the purchase itself is saved (see resolveProject).
 */
export function ProjectSelect({ value, onChange, newName, onNewName }: {
  value: string; onChange: (v: string) => void
  newName: string; onNewName: (v: string) => void
}) {
  const { data: projects } = useAsync(() => listProjects(), [])
  const offered = (projects ?? []).filter((p) => !p.finished || p.id === value)
  return (
    <>
      <label className="field">
        <span>Project (optional)</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {offered.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={NEW_PROJECT}>New project…</option>
        </select>
        <small className="hint">
          Something you're building, like a barn — Analytics › Projects adds up what it cost.
        </small>
      </label>
      {value === NEW_PROJECT && (
        <label className="field">
          <span>Project name</span>
          <input autoFocus value={newName} onChange={(e) => onNewName(e.target.value)}
            placeholder="Livestock barn" />
        </label>
      )}
    </>
  )
}

/** The project id to save with, creating a new one if that was picked. */
export async function resolveProject(value: string, newName: string): Promise<string | null> {
  if (value === NEW_PROJECT) return newName.trim() ? createProject(newName) : null
  return value || null
}
