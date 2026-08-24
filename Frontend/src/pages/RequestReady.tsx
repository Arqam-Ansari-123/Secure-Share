import { Link, Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Inbox, Mail, ShieldCheck } from 'lucide-react'

import { Countdown, CopyButton, SectionTitle } from '../components/ui'

interface State {
  url: string
  expiresAt: string
  label?: string
}

export function RequestReady() {
  const { state } = useLocation() as { state: State | null }
  if (!state?.url) return <Navigate to="/requests/new" replace />

  // There is no server-side mail here on purpose: sending from the employee's
  // own mail client means the client recognises the sender, and it needs no
  // SMTP configuration to work.
  const mailto =
    `mailto:?subject=${encodeURIComponent(
      `Secure link to send us ${state.label || 'a credential'}`,
    )}&body=${encodeURIComponent(
      `Hello,\n\n` +
        `Please use this secure link to send us ${state.label || 'the credential'}:\n\n` +
        `${state.url}\n\n` +
        `It is encrypted in your browser, can only be opened by me, and is destroyed once I read it. ` +
        `Please do not reply to this email with the credential itself.\n\n` +
        `Thank you.\n`,
    )}`

  return (
    <>
      <SectionTitle
        kicker="Ready"
        title="Send this link to your client"
        sub="They open it, paste the credential, and it comes back encrypted to you alone."
      />

      <div className="card p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2 text-emerald-300">
          <CheckCircle2 size={18} />
          <span className="text-sm font-semibold">Request created</span>
          <span className="ml-auto">
            <Countdown to={state.expiresAt} />
          </span>
        </div>

        {state.label && (
          <p className="mb-4 text-sm text-muted">
            Asking for: <span className="font-semibold text-paper">{state.label}</span>
          </p>
        )}

        <div className="rounded-xl border border-white/10 bg-ink-950/70 p-4">
          <p className="mb-2 font-mono text-xs tracking-widest text-muted uppercase">Request link</p>
          <p className="font-mono text-sm leading-relaxed break-all text-paper/90">{state.url}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <CopyButton value={state.url} label="Copy link" />
          <a
            href={mailto}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
          >
            <Mail size={14} /> Send by email
          </a>
          <Link
            to="/requests"
            className="cursor-pointer rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
          >
            View all requests
          </Link>
          <Link
            to="/requests/new"
            className="cursor-pointer rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
          >
            Create another
          </Link>
        </div>

        {/* The token is never stored — only sha256(token) is — so this page is
            the one and only time the link can be shown. */}
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 p-3 text-xs leading-relaxed text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Copy or send this now. We store only a hash of the link, so it cannot be shown again — if
          you navigate away without sending it, you will need to create a new request.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="card flex gap-3 p-5">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-navy-lit" />
          <div>
            <p className="mb-1 text-sm font-semibold">This link is safe to email</p>
            <p className="text-sm leading-relaxed text-muted">
              Unlike a secret link, it carries no credential — it only lets someone{' '}
              <em>send you</em> one. The worst a stranger could do with it is submit something you
              did not ask for.
            </p>
          </div>
        </div>

        <div className="card flex gap-3 p-5">
          <Inbox size={18} className="mt-0.5 shrink-0 text-brand-red-hot" />
          <div>
            <p className="mb-1 text-sm font-semibold">You will be notified</p>
            <p className="text-sm leading-relaxed text-muted">
              When the client responds it appears under Requests. You can open it once, and only
              you can decrypt it.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
