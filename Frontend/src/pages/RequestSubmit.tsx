import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Inbox, Loader2, ShieldCheck } from 'lucide-react'

import { api, ApiError, type RequestPublic } from '../lib/api'
import { sealTo } from '../lib/keys'
import { Button } from '../components/ui'

type Phase = 'loading' | 'form' | 'sending' | 'done' | 'error'

/**
 * The client-facing page. Someone outside Genetech opens this from a link.
 *
 * Deliberately a dead end, like the reveal page: branded so it is credible, but
 * with no navigation, nothing to sign into, and no path into the rest of the
 * app. The secret is encrypted here, in their browser, to the requesting
 * employee's public key — so it is unreadable by our servers from the moment it
 * leaves this page.
 */
export function RequestSubmit() {
  const { token = '' } = useParams()

  const [phase, setPhase] = useState<Phase>('loading')
  const [info, setInfo] = useState<RequestPublic | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .viewRequest(token)
      .then((r) => {
        if (!alive) return
        setInfo(r)
        setPhase('form')
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(
          e instanceof ApiError && e.status === 404
            ? 'We have no record of this link. Check it was copied in full, or ask your contact to resend it.'
            : e instanceof ApiError && e.status === 410
              ? 'This request has already been answered, withdrawn, or has expired. Ask your contact for a new link.'
              : 'This request could not be loaded.',
        )
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !info) return
    setPhase('sending')
    setError('')
    try {
      // Encrypted here, before any network call exists.
      await api.submitRequest(token, await sealTo(info.pubkey, text))
      setText('')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send. Please try again.')
      setPhase('form')
    }
  }

  if (phase === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-brand-navy-lit" size={28} />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 text-brand-red-hot" size={32} />
        <h1 className="mb-2 text-xl font-bold">This link is not available</h1>
        <p className="text-sm leading-relaxed text-muted">{error}</p>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <CheckCircle2 className="mx-auto mb-4 text-emerald-400" size={34} />
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight">Sent securely</h1>
        <p className="text-sm leading-relaxed text-muted">
          {info?.requested_by} has been notified. Your credential was encrypted in this browser and
          can be opened once, by them alone. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-navy-lit/15 text-brand-navy-lit">
            <Inbox size={18} />
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              {info?.requested_by} has requested a credential
            </h1>
            <p className="text-xs text-muted">{info?.requested_by_email} · Genetech Solutions</p>
          </div>
        </div>

        {info?.label && (
          <div className="mb-5 rounded-xl border border-white/10 bg-white/4 p-4">
            <p className="mb-1 font-mono text-xs tracking-widest text-muted uppercase">Requested</p>
            <p className="text-sm font-semibold">{info.label}</p>
          </div>
        )}

        <form onSubmit={submit}>
          <label htmlFor="secret" className="mb-2 block text-sm font-semibold">
            Your credential
          </label>
          <textarea
            id="secret"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the password, API key or connection string here..."
            // Browser spellcheck uploads text to a remote service. Never on a
            // secret field.
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full resize-y rounded-xl border border-white/10 bg-ink-950/60 p-4 font-mono text-sm text-paper placeholder:text-muted/60 focus:border-brand-navy-lit focus:outline-none"
          />

          {error && (
            <p className="mt-3 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <Button type="submit" disabled={phase === 'sending' || !text.trim()} className="mt-5 w-full">
            {phase === 'sending' ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Encrypting and sending...
              </span>
            ) : (
              'Send securely'
            )}
          </Button>
        </form>

        <p className="mt-5 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          Encrypted in your browser before it is sent. Genetech&apos;s servers store it in a form
          they cannot read, and it is destroyed once {info?.requested_by} opens it.
        </p>
      </div>
    </div>
  )
}
