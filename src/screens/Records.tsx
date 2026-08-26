import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { recentLogs } from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { LogList } from './LogList'
import { EditLog } from './EditLog'

/**
 * The raw log, newest first. Body only — no heading of its own: this used to
 * be its own tab sitting next to Analytics, and the two were the same
 * question ("what has happened here?") answered at two zoom levels. They
 * share one tab now, and Analytics owns the header.
 */
export function Records() {
  const { data, loading, reload } = useAsync(() => recentLogs(200), [])
  const [editing, setEditing] = useState<LogWithDetail | null>(null)

  return (
    <>
      <LogList logs={data ?? []} loading={loading} onSelect={setEditing} />

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
