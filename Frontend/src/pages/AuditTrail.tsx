import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  Clock,
  Eye,
  Flame,
  Loader2,
  LogIn,
  Plus,
  ShieldX,
  Webhook,
} from 'lucide-react'

import { staffApi, type AuditRow } from '../lib/api-staff'
import { SectionTitle } from '../components/ui'

/** Event vocabulary, kept in one place so the timeline reads consistently. */
const EVENTS: Record<string, { icon: typeof Plus; label: string; note: string; tone: string }> = {
  created: {
    icon: Plus,
    label: 'Created',
    note: 'Secret encrypted and stored',
    tone: 'text-brand-navy-lit',
  },
  peeked: {
    icon: Eye,
    label: 'Link opened',
    note: 'Confirmation screen shown. Secret NOT revealed.',
    tone: 'text-muted',
  },
  reveal_ok: {
    icon: Flame,
    label: 'Revealed',
    note: 'Secret delivered and destroyed',
    tone: 'text-brand-red-hot',
  },
  reveal_fail: {
    icon: ShieldX,
    label: 'Failed attempt',
    note: 'Incorrect passphrase',
    tone: 'text-amber-400',
  },
  destroyed: {
    icon: Flame,
    label: 'Destroyed',
    note: 'Too many failed attempts',
    tone: 'text-brand-red-hot',
  },
  revoked: { icon: Ban, label: 'Revoked', note: 'Withdrawn by the sender', tone: 'text-brand-red-hot' },
  expired: {
    icon: Clock,
    label: 'Expired',
    note: 'Time limit reached, never opened',
    tone: 'text-muted',
  },
  notified: {
    icon: Webhook,
    label: 'Notification sent',
    note: 'Webhook or email dispatched',
    tone: 'text-muted',
  },
  login_ok: { icon: LogIn, label: 'Signed in', note: '', tone: 'text-muted' },
}

export function AuditTrail() {
  const { tid = '' } = useParams()
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    staffApi
      .audit(tid)
      .then(setRows)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not load the audit trail.'),
      )
  }, [tid])

  if (error) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted">{error}</p>
      </div>
    )
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
      <Link
        to="/dashboard"
        className="mb-6 inline-flex cursor-pointer items-center gap-2 text-sm text-muted transition hover:text-paper"
      >
        <ArrowLeft size={15} /> Back to dashboard
      </Link>

      <SectionTitle
        kicker="Audit trail"
        title="Everything that happened to this secret"
        sub="Recorded in a separate database schema that the application can append to but cannot edit or delete."
      />

      <p className="mb-6 font-mono text-xs break-all text-muted">{tid}</p>

      <ol className="relative space-y-4 border-l border-white/10 pl-6">
        {rows.map((r, i) => {
          const e = EVENTS[r.event] ?? { icon: Plus, label: r.event, note: '', tone: 'text-muted' }
          return (
            <li key={i} className="relative">
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
                {e.note && <p className="mb-2 text-sm text-muted">{e.note}</p>}

                {/* Staff actions name a person; recipient actions deliberately
                    do not, because a recipient has no account. */}
                {r.actor_email && (
                  <p className="mb-2 text-sm">
                    <span className="text-muted">by </span>
                    <span className="font-semibold text-paper">{r.actor_email}</span>
                  </p>
                )}

                <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted">
                  <span>
                    IP <span className="text-paper">{r.ip ?? 'unknown'}</span>
                  </span>
                  {r.user_agent && <span className="max-w-full truncate">UA {r.user_agent}</span>}
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
    </>
  )
}
