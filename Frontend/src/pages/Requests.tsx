import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  User,
} from 'lucide-react'

import { staffApi, type RequestRow } from '../lib/api-staff'
import { fromB64 } from '../lib/crypto'
import { openWith } from '../lib/keys'
import { currentPublicKey, needsPassword, privateKey, unlockWithPassword } from '../lib/vault'
import { useAuth } from '../lib/auth'
import { KeyMigration } from '../components/KeyMigration'
import {
  Button,
  Countdown,
  CopyButton,
  Pager,
  StatusPill,
  usePaged,
  usePrefersReducedMotion,
} from '../components/ui'

/** Four cards is about a screenful. The list arrives whole either way — the
 *  server already caps it at 200 — so this only changes what is rendered. */
const PAGE_SIZE = 4

/** The label depends on the reply's state, not just the request's — "Reply
 *  received" is misleading once the employee has already read and destroyed it. */
function statusLabel(r: RequestRow): string {
  if (r.status !== 'fulfilled') {
    return { open: 'Awaiting reply', expired: 'Expired', revoked: 'Revoked' }[
      r.status as 'open' | 'expired' | 'revoked'
    ]
  }
  if (r.reply_status === 'viewed') return 'Read and destroyed'
  if (r.reply_status === 'active') return 'Reply waiting for you'
  return 'Reply expired unread'
}

export function Requests() {
  const { user } = useAuth()
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<Record<string, string>>({})
  const [masked, setMasked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  // Per-row, so feedback appears next to the button that was actually clicked.
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [locked, setLocked] = useState(needsPassword())
  const [password, setPassword] = useState('')
  const unlockRef = useRef<HTMLFormElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  // `slice` is what gets rendered; `rows` stays whole, and reveal() below still
  // searches the whole array.
  const { page, setPage, pageCount, slice } = usePaged(rows, PAGE_SIZE)

  /** The pager sits below four cards, so without this a page change leaves you
   *  looking at the bottom of fresh content. */
  function goToPage(next: number) {
    setPage(next)
    listRef.current?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  const load = () =>
    staffApi
      .listRequests()
      .then(setRows)
      .catch(() => setRows([]))

  useEffect(() => {
    void load()
  }, [])

  async function unlockVault(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (await unlockWithPassword(password)) {
      setLocked(false)
      setPassword('')
    } else {
      setError('That password did not unlock your key.')
    }
  }

  /** Retrieve and decrypt a client's reply. One-time — the server destroys it. */
  async function reveal(rid: string) {
    setRowError((e) => ({ ...e, [rid]: '' }))

    // Without a key there is nothing to do but ask for the password. Say so on
    // the row AND move the prompt into view: it lives at the top of the page,
    // so silently revealing it there reads as "the button does nothing".
    const priv = await privateKey()
    if (!priv) {
      setLocked(true)
      setRowError((e) => ({
        ...e,
        [rid]: 'Your encryption key is locked. Enter your password above to read this.',
      }))
      requestAnimationFrame(() => {
        unlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pwRef.current?.focus()
      })
      return
    }

    // Retrieval is a GETDEL — the ciphertext is destroyed the moment we ask for
    // it. So check the key MATCHES before asking. Without this, a rotated
    // keypair means one click both destroys the credential and fails to decrypt
    // it, with nothing recoverable afterwards.
    const row = rows?.find((x) => x.rid === rid)
    const mine = currentPublicKey()
    if (row?.request_pubkey && mine && row.request_pubkey.replace(/\s/g, '') !== mine) {
      setRowError((e) => ({
        ...e,
        [rid]:
          'This was encrypted to a different key of yours — your keypair has been replaced since ' +
          'this request was sent, most likely by an administrator password reset. It cannot be ' +
          'decrypted, so it has been left intact rather than destroyed. Ask your client to resend ' +
          'against a new request.',
      }))
      return
    }

    setBusy(rid)
    try {
      const res = await staffApi.takeReply(rid)
      const plain = await openWith(priv, fromB64(res.blob))
      setOpened((o) => ({ ...o, [rid]: plain }))
      setMasked((m) => ({ ...m, [rid]: true }))
      await load()
    } catch (err) {
      setRowError((e) => ({
        ...e,
        [rid]:
          err instanceof Error
            ? err.message
            : 'Could not open the reply. Your key may not match the one this was encrypted to.',
      }))
    } finally {
      setBusy(null)
    }
  }

  async function revoke(rid: string) {
    setBusy(rid)
    try {
      await staffApi.revokeRequest(rid)
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (!rows) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brand-navy-lit" size={26} />
      </div>
    )
  }

  return (
    <>
      {/* The primary action has to live here, not only in the empty state —
          otherwise there is no way to create a second request. */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 font-mono text-xs tracking-[0.2em] text-brand-red uppercase">
            Credential requests
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {user?.is_admin ? 'All requests' : 'Secrets you have asked clients for'}
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            You send a client a link. They paste their credential into it, encrypted to your key.
            Only you can read what comes back.
          </p>
        </div>
        <Link
          to="/requests/new"
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-brand-navy-lit px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-navy-lit/85"
        >
          <Plus size={16} /> New request
        </Link>
      </div>

      <KeyMigration />

      {locked && (
        <form
          ref={unlockRef}
          onSubmit={unlockVault}
          className="card mb-5 flex flex-wrap items-end gap-3 border-amber-400/30 bg-amber-400/5 p-5"
        >
          <Lock size={18} className="mb-2 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-sm font-semibold">Unlock your encryption key</p>
            <p className="mb-3 text-xs text-muted">
              Your sign-in lasts 30 days, but the key is only held for the current browser session —
              so it is not left sitting in a browser for a month. Enter your password to read
              replies. Sending secrets and creating requests work without this.
            </p>
            <input
              ref={pwRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
              className="w-full max-w-sm rounded-xl border border-white/10 bg-ink-950/60 p-3 font-mono text-sm focus:border-brand-navy-lit focus:outline-none"
            />
          </div>
          <Button type="submit" disabled={!password}>
            Unlock
          </Button>
        </form>
      )}

      {error && (
        <p className="mb-5 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center p-12 text-center">
          <Inbox size={30} className="mb-4 text-muted" />
          <h3 className="mb-2 text-lg font-bold">No requests yet</h3>
          <p className="mb-6 max-w-sm text-sm text-muted">
            When you need a credential from a client, send them a request link instead of asking
            them to email it.
          </p>
          <Link
            to="/requests/new"
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-brand-navy-lit px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-navy-lit/85"
          >
            <Plus size={15} /> Request credentials
          </Link>
        </div>
      ) : (
        <div ref={listRef} className="space-y-3">
          {slice.map((r) => (
            <div key={r.rid} className="card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold">{r.label || 'Untitled request'}</p>
                    <StatusPill
                      status={
                        r.status === 'open'
                          ? 'active'
                          : r.status === 'fulfilled'
                            ? r.reply_status === 'active'
                              ? 'active' // still waiting to be read
                              : 'viewed'
                            : r.status
                      }
                    />
                    <span className="text-xs text-muted">{statusLabel(r)}</span>
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {user?.is_admin && r.requested_by && (
                      <span className="text-paper">
                        <User size={11} className="mr-1 inline" />
                        {r.requested_by}
                        {' · '}
                      </span>
                    )}
                    {r.client_hint && <>{r.client_hint} · </>}
                    {new Date(r.created_at).toLocaleString()}
                    {r.status === 'open' && (
                      <>
                        {' · '}
                        <Countdown to={r.expires_at} />
                      </>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* A reply can be opened exactly once. reply_status comes from
                      the server, so this stays correct after a page reload —
                      component state alone would show the button again and the
                      click would 410. */}
                  {r.status === 'fulfilled' && r.reply_status === 'active' && !opened[r.rid] && (
                    <Button onClick={() => void reveal(r.rid)} disabled={busy === r.rid}>
                      {busy === r.rid ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <span className="flex items-center gap-2">
                          <KeyRound size={14} /> Open reply
                        </span>
                      )}
                    </Button>
                  )}

                  {r.status === 'fulfilled' && r.reply_status === 'viewed' && (
                    <span className="flex items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold text-muted">
                      <CheckCircle2 size={14} className="text-emerald-400" />
                      Already opened
                      {r.reply_read_at && (
                        <span className="font-mono font-normal">
                          {new Date(r.reply_read_at).toLocaleString()}
                        </span>
                      )}
                    </span>
                  )}

                  {r.status === 'fulfilled' &&
                    r.reply_status &&
                    !['active', 'viewed'].includes(r.reply_status) && (
                      <span className="flex items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold text-muted">
                        <Clock size={14} />
                        Expired before you opened it
                      </span>
                    )}
                  {r.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => void revoke(r.rid)}
                      disabled={busy === r.rid}
                      className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-red/15 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-brand-red/25 disabled:opacity-50"
                    >
                      <Ban size={14} /> Revoke
                    </button>
                  )}
                </div>
              </div>

              {rowError[r.rid] && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
                  <Lock size={14} className="mt-0.5 shrink-0" />
                  {rowError[r.rid]}
                </p>
              )}

              {opened[r.rid] !== undefined && (
                <div className="mt-4 rounded-xl border border-brand-red/25 bg-brand-red/8 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-mono text-xs tracking-widest text-muted uppercase">
                      Client&apos;s reply — destroyed on our servers
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMasked((m) => ({ ...m, [r.rid]: !m[r.rid] }))}
                        className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
                      >
                        {masked[r.rid] ? <Eye size={14} /> : <EyeOff size={14} />}
                        {masked[r.rid] ? 'Show' : 'Hide'}
                      </button>
                      <CopyButton value={opened[r.rid]} />
                    </div>
                  </div>
                  <pre
                    className={`overflow-x-auto rounded-xl bg-ink-950/70 p-4 font-mono text-sm break-all whitespace-pre-wrap transition ${
                      masked[r.rid] ? 'blur-[7px] select-none' : ''
                    }`}
                  >
                    {opened[r.rid]}
                  </pre>
                  <p className="mt-2 text-xs text-muted">
                    Copy this now — it is gone from our servers and will not load again.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Outside the ternary on purpose: with no requests at all pageCount is 1,
          so the Pager renders nothing and the empty state stays untouched. */}
      <Pager
        page={page}
        pageCount={pageCount}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onChange={goToPage}
        noun="requests"
      />
    </>
  )
}
