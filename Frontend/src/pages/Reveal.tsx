import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Eye, EyeOff, Flame, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'

import { api, ApiError, type SecretMeta } from '../lib/api'
import { fromB64, makeVerifier, open as openEnvelope, type Opened } from '../lib/crypto'
import { Button, CopyButton, Linkify, PasswordInput } from '../components/ui'

type Phase = 'loading' | 'confirm' | 'passphrase' | 'opening' | 'open' | 'error'

export function Reveal() {
  const { token = '' } = useParams()
  const nav = useNavigate()

  const [phase, setPhase] = useState<Phase>('loading')
  const [meta, setMeta] = useState<SecretMeta | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [masked, setMasked] = useState(true)

  // The key is in the fragment. Read it once, and never put it anywhere that
  // could be transmitted: no query params, no fetch body, no logging.
  const linkKey = window.location.hash.slice(1)

  // Step 1: metadata only. This is a GET and touches nothing destructive, so a
  // mail scanner or chat unfurler following the link cannot burn the secret.
  useEffect(() => {
    let alive = true
    api
      .meta(token)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setPhase('confirm')
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
          nav('/gone', { replace: true, state: { reason: e.status === 404 ? 'unknown' : e.message } })
        } else {
          setError(e instanceof Error ? e.message : 'Could not load this secret.')
          setPhase('error')
        }
      })
    return () => {
      alive = false
    }
  }, [token, nav])

  // Step 2: the destructive call. Deliberately a POST behind a click.
  const doReveal = useCallback(async () => {
    if (!meta) return
    setError('')
    setPhase('opening')
    try {
      let ticket = meta.reveal_ticket
      // A ticket is single-use, so a retry after a wrong passphrase needs a new one.
      if (phase === 'passphrase') ticket = (await api.meta(token)).reveal_ticket

      const verifier =
        meta.has_passphrase && meta.kdf_salt && meta.kdf_iters
          ? await makeVerifier(passphrase, meta.kdf_salt, meta.kdf_iters)
          : undefined

      const res = await api.reveal(token, ticket, verifier)
      setOpened(await openEnvelope(fromB64(res.blob), linkKey, passphrase))
      setPhase('open')
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) {
        setError(e.message)
        setPhase('passphrase')
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 410)) {
        nav('/gone', { replace: true, state: { reason: e.message } })
      } else {
        // A decrypt failure here means the fragment is wrong or truncated. The
        // secret itself is already gone, so say so plainly.
        setError(
          e instanceof ApiError
            ? e.message
            : 'Decryption failed. The link may have been altered or truncated in transit.',
        )
        setPhase('error')
      }
    }
  }, [meta, phase, passphrase, token, linkKey, nav])

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
        <h1 className="mb-2 text-xl font-bold">This did not work</h1>
        <p className="text-sm text-muted">{error}</p>
      </div>
    )
  }

  // ------------------------------------------------------------------ opened
  if (phase === 'open' && opened) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-brand-red/25 bg-brand-red/8 p-4">
          <Flame size={17} className="shrink-0 text-brand-red-hot" />
          <p className="text-sm">
            <span className="font-semibold">Destroyed.</span>{' '}
            <span className="text-muted">
              This secret no longer exists on our servers. Copy it now, the page will not load again.
            </span>
          </p>
        </div>

        {opened.text && (
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-xs tracking-widest text-muted uppercase">Secret</p>
              {/* shrink-0 only. The label here is one short word so the row
                  never wraps -- no need to restructure a layout that works. */}
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setMasked((m) => !m)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold transition hover:bg-white/12"
                >
                  {masked ? <Eye size={14} /> : <EyeOff size={14} />}
                  {masked ? 'Show' : 'Hide'}
                </button>
                <CopyButton value={opened.text} />
              </div>
            </div>
            {/* pointer-events-none while masked: the text is blurred for
                shoulder-surfing, so a link under it should not be clickable
                either. */}
            <pre
              className={`overflow-x-auto rounded-xl bg-ink-950/70 p-4 font-mono text-sm break-all whitespace-pre-wrap transition ${
                masked ? 'pointer-events-none blur-[7px] select-none' : ''
              }`}
            >
              <Linkify text={opened.text} />
            </pre>
          </div>
        )}

      </div>
    )
  }

  // ------------------------------------------------- confirm / passphrase gate
  const needsPass = phase === 'passphrase' || (phase !== 'opening' && meta?.has_passphrase)

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8 text-center">
        <div
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-navy/25"
          style={{ animation: 'pulse-ring 2.4s ease-out infinite' }}
        >
          <LockKeyhole size={30} className="text-brand-navy-lit" />
        </div>

        <h1 className="mb-3 text-2xl font-extrabold tracking-tight">Someone sent you a secret</h1>
        <p className="mb-6 text-sm leading-relaxed text-muted">
          It can be opened <span className="font-semibold text-paper">exactly once</span>. Opening it
          destroys it, so make sure you can save it somewhere before you continue.
        </p>

        {needsPass && (
          <div className="mb-5 text-left">
            <label htmlFor="pp" className="mb-2 block text-sm font-semibold">
              Passphrase required
            </label>
            <PasswordInput
              id="pp"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && passphrase && void doReveal()}
              autoComplete="off"
              autoFocus
            />
            {meta && (
              <p className="mt-2 font-mono text-xs text-muted">
                {meta.attempts_remaining} attempt{meta.attempts_remaining === 1 ? '' : 's'} remaining
                before this secret is destroyed
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mb-4 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <Button
          variant="danger"
          onClick={() => void doReveal()}
          disabled={phase === 'opening' || (Boolean(needsPass) && !passphrase)}
          className="w-full"
        >
          {phase === 'opening' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Opening...
            </span>
          ) : (
            'Reveal and destroy'
          )}
        </Button>

        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted">
          <ShieldCheck size={13} />
          Decrypted in your browser. The server never sees the contents.
        </p>
      </div>
    </div>
  )
}
