import { Link, Navigate, useLocation } from 'react-router-dom'
import { CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react'

import { Countdown, CopyButton, SectionTitle } from '../components/ui'

interface State {
  url: string
  expiresAt: string
  hasPassphrase: boolean
}

export function LinkReady() {
  const { state } = useLocation() as { state: State | null }

  // Reached directly, with no secret just created — nothing to show.
  if (!state?.url) return <Navigate to="/create" replace />

  const [base, fragment] = state.url.split('#')

  return (
    <>
      <SectionTitle
        kicker="Ready"
        title="Your link is live"
        sub="This is the only time it will be shown. We stored a hash of it, not the link itself."
      />

      <div className="card p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2 text-emerald-300">
          <CheckCircle2 size={18} />
          <span className="text-sm font-semibold">Encrypted and stored</span>
          <span className="ml-auto">
            <Countdown to={state.expiresAt} />
          </span>
        </div>

        {/* The two halves are shown apart on purpose — it makes the fragment
            visible as a distinct thing, which is what the warning below is about. */}
        <div className="rounded-xl border border-white/10 bg-ink-950/70 p-4">
          <p className="mb-2 font-mono text-xs tracking-widest text-muted uppercase">Share this link</p>
          <p className="font-mono text-sm leading-relaxed break-all">
            <span className="text-paper/80">{base}#</span>
            <span className="text-brand-red-hot">{fragment}</span>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <CopyButton value={state.url} label="Copy link" />
          <Link
            to="/create"
            className="cursor-pointer rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
          >
            Create another
          </Link>
          <Link
            to="/dashboard"
            className="cursor-pointer rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
          >
            Go to dashboard
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="card flex gap-3 p-5">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-brand-red-hot" />
          <div>
            <p className="mb-1 text-sm font-semibold">The red part is the key</p>
            <p className="text-sm leading-relaxed text-muted">
              Everything after <code className="font-mono text-paper">#</code> is the decryption key. It
              never reached our servers and is not recoverable — if you lose this link, the secret is
              genuinely unreadable by anyone, including us.
            </p>
          </div>
        </div>

        {state.hasPassphrase && (
          <div className="card flex gap-3 p-5">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-brand-navy-lit" />
            <div>
              <p className="mb-1 text-sm font-semibold">Send the passphrase separately</p>
              <p className="text-sm leading-relaxed text-muted">
                A passphrase in the same message as the link protects nothing. Use a different channel —
                a call, SMS, or a different app.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
