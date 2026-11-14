// Phone notifications, run once a day by notify.sh: "Daisy may come into
// heat around Sat, Nov 21", a week ahead, to everyone on her farm who
// turned alerts on (Settings > Phone alerts). Each expected heat is sent
// once — see src/lib/heatAlerts.ts, which decides what is due and is the
// same heat arithmetic the app shows, imported rather than copied.
//
// Database access is PropertyManagement's pattern: docker compose exec
// psql as postgres (which reads across farms, deliberately past the
// row-level security the app is held to), values passed as -v variables
// and referenced as :'name', never put into the SQL string.
//
//   node --experimental-strip-types send-notifications.ts
//   node --experimental-strip-types send-notifications.ts --dry-run   # say what would go, send nothing

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'
import { heatAlerts, type HeatAlertAnimal } from '../../src/lib/heatAlerts.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry-run')

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

function psql(sql: string, vars: Record<string, string> = {}): string {
  const args = ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-qtAX', '-v', 'ON_ERROR_STOP=1']
  for (const [key, value] of Object.entries(vars)) args.push('-v', `${key}=${value}`)
  return execFileSync('docker', args, { cwd: HERE, input: sql, encoding: 'utf8' })
}

const env = loadEnv(join(HERE, '.env'))
if (!DRY) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not all set in deploy/selfhost/.env — nothing to send with.')
    process.exit(1)
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
}

// Every animal with a heat on record, on a farm where somebody has a phone
// to send to: her last heat and last breeding, and her farm's timezone.
interface Row extends HeatAlertAnimal { timezone: string | null }
const animals: Row[] = JSON.parse(psql(`
  select coalesce(jsonb_agg(r), '[]') from (
    select a.farm_id as "farmId", f.timezone, a.id as "assetId", a.name,
           a.attributes->>'species' as species,
           max(case when l.type = 'heat' then l.timestamp end) as "lastHeat",
           max(case when l.type = 'breeding' then l.timestamp end) as "lastBred"
      from asset a
      join farm f on f.id = a.farm_id
      join log_asset la on la.asset_id = a.id and la.role = 'subject'
      join log l on l.id = la.log_id and l.type in ('heat', 'breeding')
           and l.status = 'done' and l.deleted_at is null
     where a.type = 'animal' and a.status = 'active' and a.deleted_at is null
       ${DRY ? '' : `and exists (select 1 from farm_member fm join push_subscription ps on ps.user_id = fm.user_id
                                  where fm.farm_id = a.farm_id)`}
     group by a.farm_id, f.timezone, a.id, a.name, a.attributes
    having max(case when l.type = 'heat' then l.timestamp end) is not null
  ) r;`).trim())

// Worked out farm by farm in that farm's own timezone: "in 7 days" counts
// from the farm's today, not the server's.
const byZone = new Map<string, Row[]>()
for (const a of animals) {
  const tz = a.timezone || 'UTC'
  byZone.set(tz, [...(byZone.get(tz) ?? []), a])
}
const due = [...byZone].flatMap(([tz, rows]) => {
  process.env.TZ = tz
  return heatAlerts(rows)
})
if (due.length === 0) process.exit(0)

let pushed = 0
for (const alert of due) {
  const already = psql(`select 1 from push_sent where key = :'key';`, { key: alert.key }).trim()
  if (already) continue
  if (DRY) {
    console.log(`would send: ${alert.title} — ${alert.body}`)
    continue
  }
  const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = JSON.parse(psql(`
    select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]')
      from push_subscription ps
      join farm_member fm on fm.user_id = ps.user_id
     where fm.farm_id = :'farm';`, { farm: alert.farmId }).trim())

  const payload = JSON.stringify({ title: alert.title, body: alert.body, link: '/', tag: alert.key })
  let delivered = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload, { TTL: 60 * 60 * 24 },
      )
      delivered++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404/410: the push service says this phone's subscription is gone
      // (alerts turned off, app removed from the home screen). Anything
      // else is left alone, so one bad day doesn't unsubscribe anyone.
      if (status === 404 || status === 410) {
        psql(`delete from push_subscription where id = :'id';`, { id: sub.id })
      } else {
        console.error(`push to subscription ${sub.id} failed: ${status ?? (err as Error).message}`)
      }
    }
  }
  // Only marked sent once a phone has it: a farm whose only phone failed
  // today gets it tomorrow instead of never.
  if (delivered > 0) {
    psql(`insert into push_sent (key) values (:'key') on conflict do nothing;`, { key: alert.key })
    pushed += delivered
  }
}
if (pushed > 0) console.log(`sent ${pushed} notification(s)`)
