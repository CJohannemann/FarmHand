import { useAsync } from '../lib/useAsync'
import { recentLogs } from '../db/queries'
import { LogList } from './LogList'

export function Records() {
  const { data, loading } = useAsync(() => recentLogs(200), [])
  return (
    <div className="screen">
      <h1>Records</h1>
      <p className="tagline">Everything, newest first.</p>
      <LogList logs={data ?? []} loading={loading} />
    </div>
  )
}
