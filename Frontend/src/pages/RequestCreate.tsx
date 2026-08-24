import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Inbox, Loader2, ShieldCheck } from 'lucide-react'

import { ApiError } from '../lib/http'
import { staffApi } from '../lib/api-staff'
import { Button, SectionTitle } from '../components/ui'

const EXPIRY = [
  { id: 24 * 3600, label: '24 hours', hint: 'short turnaround' },
  { id: 3 * 24 * 3600, label: '3 days', hint: 'a working week' },
  { id: 7 * 24 * 3600, label: 'Default', hint: 'link closes after 7 days' },
  { id: 30 * 24 * 3600, label: '30 days', hint: 'slow-moving clients' },
] as const

export function RequestCreate() {
  const nav = useNavigate()

  const [label, setLabel] = useState('')
  const [clientHint, setClientHint] = useState('')
  const [expiry, setExpiry] = useState<number>(7 * 24 * 3600)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await staffApi.createRequest({
        label: label.trim() || null,
        client_hint: clientHint.trim() || null,
        expires_in: expiry,
      })
      nav('/requests/ready', {
        state: { url: res.url, expiresAt: res.expires_at, label: label.trim() },
      })
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.',
      )
      setBusy(false)
    }
  }

  return (
    <>
      <SectionTitle
        kicker="Request credentials"
        title="Ask a client to send you a secret"
        sub="They get a one-time link. No account, no password, and nothing they can use to reach the rest of this app."
      />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <label htmlFor="label" className="mb-2 block text-sm font-semibold">
              What are you asking for?
            </label>
            <input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="Production database credentials"
              className="w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm focus:border-brand-navy-lit focus:outline-none"
            />
            <p className="mt-2 text-xs text-muted">
              The client sees this, so write it for them.
            </p>
          </div>

          <div className="card p-5">
            <label htmlFor="hint" className="mb-2 block text-sm font-semibold">
              Who are you sending it to? <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="hint"
              value={clientHint}
              onChange={(e) => setClientHint(e.target.value)}
              maxLength={200}
              placeholder="Acme Ltd — Sarah in IT"
              className="w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm focus:border-brand-navy-lit focus:outline-none"
            />
            <p className="mt-2 flex items-start gap-2 text-xs text-amber-300/80">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              For your own records only — the client never sees this, but it is stored unencrypted.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <p className="mb-3 text-sm font-semibold">Link stays open for</p>
            <div className="grid grid-cols-2 gap-2">
              {EXPIRY.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setExpiry(o.id)}
                  className={`cursor-pointer rounded-xl border p-3 text-left transition-all duration-200 ${
                    expiry === o.id
                      ? 'border-brand-navy-lit/60 bg-brand-navy-lit/12'
                      : 'border-white/10 bg-white/3 hover:border-white/20 hover:bg-white/6'
                  }`}
                  aria-pressed={expiry === o.id}
                >
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Whatever the client sends inherits this deadline, so a credential never outlives the
              request that asked for it.
            </p>
          </div>

          <div className="card flex gap-3 p-5">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-navy-lit" />
            <p className="text-sm leading-relaxed text-muted">
              The client encrypts to <span className="font-semibold text-paper">your</span> key.
              Nobody else can read what they send — not another colleague, not this server.
            </p>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Creating...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Inbox size={15} /> Create request link
              </span>
            )}
          </Button>
        </div>
      </form>
    </>
  )
}
