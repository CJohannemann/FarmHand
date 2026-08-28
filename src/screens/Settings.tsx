import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { useSession } from '../lib/useSession'
import {
  createInvite, listMembers, removeMember, updateMemberRole,
  type FarmRole, type FarmMember,
} from '../lib/members'
import { ago, lastSyncedAt, pendingCount, syncClockTime, syncNow } from '../lib/sync'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { FarmName } from './Setup'
import { deleteAccount, exportEverything } from '../lib/account'
import { downloadZip } from '../lib/receipts'

const ROLE_LABEL: Record<FarmRole, string> = {
  owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer',
}
const INVITABLE_ROLES: FarmRole[] = ['manager', 'member', 'viewer']

function inviteUrl(code: string): string {
  const u = new URL(window.location.href)
  u.search = ''
  u.hash = ''
  u.searchParams.set('invite', code)
  return u.toString()
}

export function Settings() {
  const { session } = useSession()
  const members = useAsync(() => listMembers(), [])
  const isOwner = members.data?.some(
    (m) => m.userId === session?.user.id && m.role === 'owner',
  ) ?? false

  return (
    <div className="screen">
      <h1>Settings</h1>

      <label className="field">
        <span>Farm name</span>
        <FarmName />
      </label>

      <AppearancePanel />

      <SyncPanel />

      {isOwner && <InvitePanel onCreated={members.reload} />}

      <h2 style={{ marginTop: '1.5rem' }}>Who's on this farm</h2>
      {members.loading && <p className="muted">Loading…</p>}
      {members.error && <p className="error">Could not load members: {members.error.message}</p>}
      {members.data && (
        <Roster
          members={members.data}
          you={session?.user.id ?? null}
          isOwner={isOwner}
          onChanged={members.reload}
        />
      )}

      <YourDataPanel email={session?.user.email ?? null} />
    </div>
  )
}

const THEME_LABEL: Record<ThemePref, string> = {
  system: 'System', light: 'Light', dark: 'Dark',
}

/** A device display preference, not farm data — see lib/theme.ts. */
function AppearancePanel() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref)

  const choose = (t: ThemePref) => {
    setThemePref(t)
    setTheme(t)
  }

  return (
    <div className="banner" style={{ marginTop: '1.25rem' }}>
      <p><strong>Appearance</strong></p>
      <div className="chipwrap" style={{ margin: '0.5rem 0' }}>
        {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
          <button key={t} type="button" className={`chip${theme === t ? ' on' : ''}`}
            onClick={() => choose(t)}>
            {THEME_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Where the sync state lives now that the top-of-screen bar only appears
 * when something is actually waiting or wrong. Syncing runs by itself — on
 * load, a couple of seconds after any change, once a minute, and whenever
 * the device gets signal back — so this is for reassurance and for the
 * occasional "push it now, I'm about to lose signal".
 */
function SyncPanel() {
  const state = useAsync(
    async () => ({ pending: await pendingCount(), last: await lastSyncedAt() }), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      await syncNow()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      state.reload()
    }
  }

  const pending = state.data?.pending ?? 0

  return (
    <div className="banner" style={{ marginTop: '1.25rem' }}>
      <p><strong>Sync</strong></p>
      <p className="hint">
        {pending > 0
          ? `${pending} ${pending === 1 ? 'change' : 'changes'} still to upload.`
          : 'Everything here is backed up.'}
      </p>
      <p className="hint">
        Last synced {syncClockTime(state.data?.last ?? null)} ({ago(state.data?.last ?? null)})
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function InvitePanel({ onCreated }: { onCreated: () => void }) {
  const [role, setRole] = useState<FarmRole>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setBusy(true); setError(null); setCopied(false)
    try {
      const inv = await createInvite(role)
      setInvite(inv)
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard permission can be denied — the link is still shown in a
      // field they can select and copy by hand, so this isn't fatal.
    }
  }

  return (
    <div className="banner" style={{ marginTop: '1.25rem' }}>
      <p><strong>Invite someone</strong></p>
      <p className="hint">
        They'll get their own login, with access to this farm's data.
      </p>

      <div className="chipwrap" style={{ margin: '0.5rem 0' }}>
        {INVITABLE_ROLES.map((r) => (
          <button key={r} type="button" className={`chip${role === r ? ' on' : ''}`}
            onClick={() => setRole(r)}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      <button className="primary" disabled={busy} onClick={create}>
        {busy ? 'Creating…' : 'Create invite'}
      </button>

      {error && <p className="error">{error}</p>}

      {invite && (
        <div style={{ marginTop: '0.75rem' }}>
          <label className="field">
            <span>Share this link — it works for 7 days, once</span>
            <input readOnly value={inviteUrl(invite.code)}
              onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="linkish" onClick={() => copy(inviteUrl(invite.code))}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  )
}

function Roster({ members, you, isOwner, onChanged }: {
  members: FarmMember[]
  you: string | null
  isOwner: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changeRole = async (userId: string, role: FarmRole) => {
    setBusy(userId); setError(null)
    try {
      await updateMemberRole(userId, role)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this farm? They'll be signed out and lose access.`)) return
    setBusy(userId); setError(null)
    try {
      await removeMember(userId)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      <ul className="assetlist">
        {members.map((m) => (
          <li key={m.userId}>
            <div className="assetrow">
              <span className="asset-name">
                {m.email}{m.userId === you ? ' (you)' : ''}
              </span>
              <span className="asset-meta">
                {isOwner && m.role !== 'owner' ? (
                  <select value={m.role} disabled={busy === m.userId}
                    onChange={(e) => changeRole(m.userId, e.target.value as FarmRole)}>
                    {(['manager', 'member', 'viewer'] as FarmRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                ) : ROLE_LABEL[m.role]}
              </span>
            </div>
            {isOwner && m.role !== 'owner' && (
              <button type="button" className="linkish" disabled={busy === m.userId}
                onClick={() => remove(m.userId, m.email)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The way out.
 *
 * "What you log is yours, and it stays yours" is a promise the landing page
 * makes, and a promise nobody can check until they try to leave. Export sits
 * directly above delete on purpose: the moment someone is considering
 * deleting is exactly when they should be offered their records first.
 */
function YourDataPanel({ email }: { email: string | null }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  const runExport = async () => {
    setBusy('Preparing…'); setError(null); setNote(null)
    try {
      const out = await exportEverything((p) =>
        setBusy(`${p.label}… (${p.done}/${p.total})`))
      downloadZip(out.filename, out.bytes)
      setNote(
        `Saved ${out.filename}.` +
        (out.missing ? ` ${out.missing} receipt image(s) couldn't be fetched — try again with a connection.` : ''),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runDelete = async () => {
    setBusy('Deleting…'); setError(null); setNote(null)
    try {
      await deleteAccount()
      // deleteAccount signs out, which unmounts this screen — nothing to
      // show afterwards, and no state worth setting on a dead component.
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <>
      <h2 style={{ marginTop: '1.5rem' }}>Your data</h2>

      <p className="hint">
        Everything this farm holds — animals, logs, costs and receipt photos —
        as a ZIP you can open in a spreadsheet or keep as a backup.
      </p>
      <button className="primary" onClick={runExport} disabled={Boolean(busy)}>
        {busy?.startsWith('Deleting') ? 'Export everything' : busy ?? 'Export everything'}
      </button>

      {note && <p className="notice">{note}</p>}

      <h3 className="danger-head">Delete your account</h3>
      {!confirming ? (
        <>
          <p className="hint">
            Permanently deletes your account. If you are the last person on this
            farm, every record on it goes too — animals, logs, costs and
            receipts. This cannot be undone.
          </p>
          <button className="linkish danger" onClick={() => { setConfirming(true); setError(null) }}>
            Delete my account…
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Export your records first if you want to keep them — after this
            there is nothing to export from.
          </p>
          <label className="field">
            {/* Typing the address is the point: a button alone is one
                mis-tap away from destroying a farm's entire history. */}
            <span>Type <code>{email ?? 'your email'}</code> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)}
              autoComplete="off" placeholder={email ?? ''} />
          </label>
          <button className="primary danger"
            disabled={Boolean(busy) || typed.trim() !== (email ?? '')}
            onClick={runDelete}>
            {busy ?? 'Delete my account permanently'}
          </button>
          <button className="linkish" onClick={() => { setConfirming(false); setTyped('') }}>
            Cancel
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </>
  )
}
