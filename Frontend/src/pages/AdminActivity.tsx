import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  Clock,
  Eye,
  Flame,
  Inbox,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  ShieldX,
  UserPlus,
  Webhook,
} from 'lucide-react'

import { staffApi, type ActivityRow } from '../lib/api-staff'
import { SectionTitle } from '../components/ui'

/** Shared vocabulary with the per-secret audit page, extended with the account
 *  and request events that only this view can reach. */
const EVENTS: Record<string, { icon: typeof Plus; label: string; tone: string }> = {
  created: { icon: Plus, label: 'Secret created', tone: 'text-brand-navy-lit' },
  peeked: { icon: Eye, label: 'Link opened', tone: 'text-muted' },
  reveal_ok: { icon: Flame, label: 'Secret revealed', tone: 'text-brand-red-hot' },
  reveal_fail: { icon: ShieldX, label: 'Failed passphrase', tone: 'text-amber-400' },
  destroyed: { icon: Flame, label: 'Destroyed', tone: 'text-brand-red-hot' },
  revoked: { icon: Ban, label: 'Revoked', tone: 'text-brand-red-hot' },
  expired: { icon: Clock, label: 'Expired', tone: 'text-muted' },
  notified: { icon: Webhook, label: 'Notification sent', tone: 'text-muted' },
  login_ok: { icon: LogIn, label: 'Signed in', tone: 'text-emerald-400' },
  login_fail: { icon: ShieldX, label: 'Failed sign-in', tone: 'text-amber-400' },
  logout: { icon: LogOut, label: 'Signed out', tone: 'text-muted' },
  password_changed: { icon: KeyRound, label: 'Password changed', tone: 'text-brand-navy-lit' },
  account_created: { icon: UserPlus, label: 'Account created', tone: 'text-emerald-400' },
  account_disabled: { icon: Ban, label: 'Account disabled', tone: 'text-brand-red-hot' },
  request_created: { icon: Inbox, label: 'Credential requested', tone: 'text-brand-navy-lit' },
  request_viewed: { icon: Eye, label: 'Request opened by client', tone: 'text-muted' },
  request_fulfilled: { icon: Inbox, label: 'Client responded', tone: 'text-emerald-400' },
  request_revoked: { icon: Ban, label: 'Request revoked', tone: 'text-brand-red-hot' },
}

const FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'login_ok', label: 'Sign-ins' },
  { id: 'login_fail', label: 'Failed sign-ins' },
  { id: 'created', label: 'Secrets created' },
  { id: 'reveal_ok', label: 'Secrets revealed' },
  { id: 'request_fulfilled', label: 'Client replies' },
]

export function AdminActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [event, setEvent] = useState('')
  const [actor, setActor] = useState('')
  const [actors, setActors] = useState<string[]>([])
  const [error, setError] = useState('')

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      setError('')
      try {
        const res = await staffApi.activity({
          event: event || undefined,
          actor: actor || undefined,
          cursor: reset ? undefined : (cursor ?? undefined),
          limit: 100,
        })
        setRows((prev) => (reset ? res.rows : [...prev, ...res.rows]))
        setCursor(res.next_cursor)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load activity.')
      } finally {
        setLoading(false)
      }
    },
    [event, actor, cursor],
  )

  // Refetch from the top whenever a filter changes.
  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, actor])

  useEffect(() => {
    staffApi
      .actors()
      .then(setActors)
      .catch(() => setActors([]))
  }, [])

  return (
    <>
      <SectionTitle
        kicker="Administrator"
        title="Company activity"
        sub="Every secret and every account event, across all staff. Written to an append-only table that the application cannot edit or delete."
      />

      <div className="card mb-5 flex flex-wrap items-center gap-2 p-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setEvent(f.id)}
            className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold transition ${
              event === f.id ? 'bg-brand-navy-lit/20 text-paper' : 'text-muted hover:bg-white/6'
            }`}
          >
            {f.label}
          </button>
        ))}

        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="ml-auto cursor-pointer rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-xs font-semibold focus:border-brand-navy-lit focus:outline-none"
        >
          <option value="">Everyone</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="mb-5 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {rows.length === 0 && !loading ? (
        <div className="card p-12 text-center text-sm text-muted">
          Nothing recorded for this filter yet.
        </div>
      ) : (
        <ol className="relative space-y-3 border-l border-white/10 pl-6">
          {rows.map((r) => {
            const e = EVENTS[r.event] ?? { icon: Plus, label: r.event, tone: 'text-muted' }
            return (
              <li key={r.id} className="relative">
                <span
                  className={`absolute top-4 -left-[31px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/12 bg-ink-800 ${e.tone}`}
                >
                  <e.icon size={11} />
                </span>
                <div className="card p-4">
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`text-sm font-bold ${e.tone}`}>{e.label}</span>
                    {!r.ok && (
                      <span className="rounded-full bg-brand-red/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                        failed
                      </span>
                    )}
                    <span className="ml-auto font-mono text-xs text-muted">
                      {new Date(r.at).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted">
                    {/* Staff actions name a person; recipient and client actions
                        cannot, because those parties have no account. */}
                    <span>
                      {r.actor_email ? (
                        <span className="text-paper">{r.actor_email}</span>
                      ) : (
                        <span className="italic">external / unauthenticated</span>
                      )}
                    </span>
                    <span>
                      IP <span className="text-paper">{r.ip ?? 'unknown'}</span>
                    </span>
                    {r.tid && <span>secret {r.tid.slice(0, 12)}</span>}
                    {r.detail &&
                      Object.entries(r.detail).map(([k, v]) => (
                        <span key={k}>
                          {k} <span className="text-paper">{String(v)}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-6 flex justify-center">
        {loading ? (
          <Loader2 className="animate-spin text-brand-navy-lit" size={22} />
        ) : cursor ? (
          <button
            type="button"
            onClick={() => void load(false)}
            className="cursor-pointer rounded-xl bg-white/6 px-5 py-3 text-sm font-semibold transition hover:bg-white/12"
          >
            Load older
          </button>
        ) : (
          rows.length > 0 && <p className="text-xs text-muted">End of the trail.</p>
        )}
      </div>
    </>
  )
}
