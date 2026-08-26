import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { useSession } from '../lib/useSession'
import {
  createInvite, listMembers, removeMember, updateMemberRole,
  type FarmRole, type FarmMember,
} from '../lib/members'
import { FarmName } from './Setup'

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

export function Settings({ onClose }: { onClose: () => void }) {
  const { session } = useSession()
  const members = useAsync(() => listMembers(), [])
  const isOwner = members.data?.some(
    (m) => m.userId === session?.user.id && m.role === 'owner',
  ) ?? false

  return (
    <main className="screen">
      <button type="button" className="back" onClick={onClose}>‹ Back</button>
      <h1>Settings</h1>

      <label className="field">
        <span>Farm name</span>
        <FarmName />
      </label>

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
    </main>
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
