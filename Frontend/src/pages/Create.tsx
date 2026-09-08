import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { ApiError } from '../lib/http'
import { staffApi } from '../lib/api-staff'
import { seal } from '../lib/crypto'
import { Button, PasswordInput, SectionTitle } from '../components/ui'

const EXPIRY = [
  { id: 'view', label: 'One view', hint: 'burns on first open' },
  { id: '1h', label: '1 hour', hint: 'or on first open' },
  { id: '24h', label: '24 hours', hint: 'or on first open' },
  { id: '7d', label: 'Default', hint: 'deleted after 7 days' },
] as const

// Mirrors MAX_BLOB_BYTES on the server. Applies to the ENCRYPTED payload, so a
// long enough pasted body can still reach it.
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Minimum length for the optional passphrase.
 *
 * This HAS to be enforced here, in the browser, and cannot be checked on the
 * server: the passphrase never leaves this page. It is stretched into a key
 * locally and the server only ever receives a verifier derived from it, which
 * is the whole point of the zero-knowledge design. So there is no server-side
 * length check to fall back on -- if this is missing, a one-character
 * passphrase is accepted, which is what QA found.
 *
 * 8 rather than the 12 used for staff account passwords (config.MIN_PASSWORD_
 * LENGTH). An account password guards a login for months; this guards one
 * secret for its TTL, is delivered out of band, and online guessing is already
 * capped by the reveal_tid rate limit and by max_attempts destroying the secret
 * outright. 12 here would push people towards not setting one at all.
 */
const MIN_PASSPHRASE = 8

export function Create() {
  const nav = useNavigate()

  const [text, setText] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['id']>('7d')
  const [maxAttempts, setMaxAttempts] = useState(5)
  const [label, setLabel] = useState('')
  const [webhook, setWebhook] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      setError('Enter a secret to share.')
      return
    }
    // Optional -- but once set, it has to be worth something.
    if (passphrase && passphrase.length < MIN_PASSPHRASE) {
      setError(`Passphrase must be at least ${MIN_PASSPHRASE} characters, or left empty.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      // Encryption happens here, before any network call exists.
      const sealed = await seal(text, passphrase)
      if (sealed.blob.byteLength > MAX_BYTES) {
        throw new Error('Encrypted payload exceeds 5 MB. Try a shorter secret.')
      }
      const res = await staffApi.create(
        {
          expiry_preset: expiry,
          has_passphrase: Boolean(passphrase),
          kdf_salt: sealed.kdf?.salt ?? null,
          kdf_iters: sealed.kdf?.iters ?? null,
          verifier: sealed.kdf?.verifier ?? null,
          max_attempts: maxAttempts,
          label: label.trim() || null,
          webhook_url: webhook.trim() || null,
          notify_email: email.trim() || null,
        },
        sealed.blob,
      )
      // The key rides in the fragment and is handed to the next screen through
      // router state, never through a query string.
      //
      // res.url comes from the server's PUBLIC_BASE_URL. Using
      // window.location.origin here would mint a link pointing at whatever host
      // the STAFF member happens to be on, which on an internal-only hostname
      // is a link no client can open.
      nav('/link', {
        state: {
          url: `${res.url}#${sealed.linkKey}`,
          expiresAt: res.expires_at,
          hasPassphrase: Boolean(passphrase),
        },
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
        kicker="New secret"
        title="Seal it in your browser"
        sub="Nothing on this page reaches our servers until it has already been encrypted."
      />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* ------------------------------------------------------- the payload */}
        <div className="space-y-5">
          <div className="card p-5">
            <label htmlFor="secret" className="mb-2 block text-sm font-semibold">
              Secret
            </label>
            <textarea
              id="secret"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste an API key, password, connection string..."
              // Browser spellcheck uploads text to a remote service. Never on a
              // secret field. Same reasoning for autocomplete and autocorrect.
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full resize-y rounded-xl border border-white/10 bg-ink-950/60 p-4 font-mono text-sm text-paper placeholder:text-muted/60 focus:border-brand-navy-lit focus:outline-none"
            />
            <p className="mt-2 text-right font-mono text-xs text-muted">{text.length} characters</p>
          </div>
        </div>

        {/* ------------------------------------------------------- the controls */}
        <div className="space-y-5">
          <div className="card p-5">
            <p className="mb-3 text-sm font-semibold">Expires after</p>
            <div className="grid grid-cols-2 gap-2">
              {EXPIRY.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setExpiry(o.id)}
                  className={`cursor-pointer rounded-xl border p-3 text-left transition-all duration-200 ${
                    expiry === o.id
                      ? 'border-brand-red/60 bg-brand-red/12 shadow-[0_8px_24px_-12px] shadow-brand-red'
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
              Every secret is destroyed on the first successful view. The timer is the outer limit
              for a secret nobody ever opens.
            </p>
          </div>

          <div className="card space-y-4 p-5">
            <div>
              <label htmlFor="pass" className="mb-2 block text-sm font-semibold">
                Passphrase <span className="font-normal text-muted">(optional)</span>
              </label>
              <PasswordInput
                id="pass"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                placeholder="Send this by a different channel"
                aria-describedby="pass-hint"
                minLength={MIN_PASSPHRASE}
              />
              {/* Live feedback, so the length rule is discovered while typing
                  rather than at submit. */}
              <p
                id="pass-hint"
                className={`mt-2 text-xs ${
                  passphrase && passphrase.length < MIN_PASSPHRASE
                    ? 'text-red-300'
                    : 'text-muted'
                }`}
              >
                {passphrase && passphrase.length < MIN_PASSPHRASE
                  ? `${MIN_PASSPHRASE - passphrase.length} more character${
                      MIN_PASSPHRASE - passphrase.length === 1 ? '' : 's'
                    } needed`
                  : `Leave empty for no passphrase, or use at least ${MIN_PASSPHRASE} characters.`}
              </p>
            </div>

            {passphrase && (
              <div>
                <label htmlFor="att" className="mb-2 block text-sm font-semibold">
                  Destroy after <span className="font-mono text-brand-red-hot">{maxAttempts}</span>{' '}
                  failed attempts
                </label>
                <input
                  id="att"
                  type="range"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  className="w-full cursor-pointer accent-brand-red"
                />
              </div>
            )}

            <div>
              <label htmlFor="label" className="mb-2 block text-sm font-semibold">
                Label <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder="Staging DB credentials"
                className="w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm focus:border-brand-navy-lit focus:outline-none"
              />
              <p className="mt-2 flex items-start gap-2 text-xs text-amber-300/80">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Only your team sees this, but it is stored unencrypted. Keep hints out of it.
              </p>
            </div>
          </div>

          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              Notify me when it is opened
            </summary>
            <div className="mt-4 space-y-3">
              <input
                type="url"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 font-mono text-xs focus:border-brand-navy-lit focus:outline-none"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@genetechsolutions.com"
                className="w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm focus:border-brand-navy-lit focus:outline-none"
              />
            </div>
          </details>

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="danger"
            disabled={busy || (Boolean(passphrase) && passphrase.length < MIN_PASSPHRASE)}
            className="w-full"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Encrypting...
              </span>
            ) : (
              'Encrypt and create link'
            )}
          </Button>
        </div>
      </form>
    </>
  )
}
