import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { recentLogs } from '../db/queries'
import type { LogWithDetail } from '../db/types'
import { LogList } from './LogList'
import { EditLog } from './EditLog'

export function Records() {
  const { data, loading, reload } = useAsync(() => recentLogs(200), [])
  const [editing, setEditing] = useState<LogWithDetail | null>(null)

  return (
    <div className="screen">
      <h1>Records</h1>
      <p className="tagline">Everything, newest first. Tap one to fix it.</p>
      <LogList logs={data ?? []} loading={loading} onSelect={setEditing} />

      {editing && (
        <EditLog
          log={editing}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}
