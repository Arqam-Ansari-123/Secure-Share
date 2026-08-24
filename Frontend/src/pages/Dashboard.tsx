import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, KeyRound, Loader2, ScrollText, Trash2, User } from 'lucide-react'

import { staffApi, type SecretRow } from '../lib/api-staff'
import { useAuth } from '../lib/auth'
import {
  Countdown,
  Pager,
  SectionTitle,
  StatusPill,
  usePaged,
  usePrefersReducedMotion,
} from '../components/ui'

/** Matches the requests page. The server already caps the list at 200; this
 *  only changes how many of them are rendered at once. */
const PAGE_SIZE = 4

export function Dashboard() {
  const { user } = useAuth()
  const [rows, setRows] = useState<SecretRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  const { page, setPage, pageCount, slice } = usePaged(rows, PAGE_SIZE)

  function goToPage(next: number) {
    setPage(next)
    listRef.current?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  const load = () =>
    staffApi
      .list()
      .then(setRows)
      .catch(() => setRows([]))

  useEffect(() => {
    void load()
  }, [])

  async function revoke(tid: string) {
    setBusy(tid)
    try {
      await staffApi.revoke(tid)
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
      <SectionTitle
        kicker="Your secrets"
        title={user?.is_admin ? 'All secrets' : 'Every link you have created'}
        sub={
          user?.is_admin
            ? 'You are an administrator, so this shows the whole company. Contents are never stored in a readable form.'
            : 'Status, timing and audit trail. Contents are never shown here, and could not be displayed even if we wanted to.'
        }
      />

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center p-12 text-center">
          <Inbox size={30} className="mb-4 text-muted" />
          <h3 className="mb-2 text-lg font-bold">Nothing here yet</h3>
          <p className="mb-6 max-w-sm text-sm text-muted">
            Secrets you create will appear here with their live status, so you know the moment one
            has been opened.
          </p>
          <Link
            to="/create"
            className="cursor-pointer rounded-xl bg-brand-red px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-red-hot"
          >
            Create your first secret
          </Link>
        </div>
      ) : (
        <div ref={listRef} className="space-y-3">
          {slice.map((r) => (
            <div
              key={r.tid}
              className="card flex flex-col gap-4 p-5 transition hover:bg-white/6 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{r.label || 'Untitled secret'}</p>
                  <StatusPill status={r.status} />
                  {r.has_passphrase && (
                    <span title="Passphrase protected">
                      <KeyRound size={13} className="text-muted" />
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs text-muted">
                  {/* Only meaningful on the admin view, where rows span people. */}
                  {user?.is_admin && r.created_by && (
                    <span className="text-paper">
                      <User size={11} className="mr-1 inline" />
                      {r.created_by}
                      {' · '}
                    </span>
                  )}
                  {r.tid.slice(0, 16)}
                  {'... created '}
                  {new Date(r.created_at).toLocaleString()}
                  {r.status === 'active' && (
                    <>
                      {' · '}
                      <Countdown to={r.expires_at} />
                    </>
                  )}
                  {r.failed_attempts > 0 && (
                    <span className="text-brand-red-hot">
                      {' · '}
                      {r.failed_attempts}/{r.max_attempts} failed attempts
                    </span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  to={`/dashboard/${r.tid}`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
                >
                  <ScrollText size={14} /> Audit
                </Link>
                {r.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => void revoke(r.tid)}
                    disabled={busy === r.tid}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-red/15 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-brand-red/25 disabled:opacity-50"
                  >
                    {busy === r.tid ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outside the ternary: with no secrets pageCount is 1, so this renders
          nothing and the empty state is unaffected. */}
      <Pager
        page={page}
        pageCount={pageCount}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onChange={goToPage}
        noun="secrets"
      />
    </>
  )
}
