import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader2, LogIn, ShieldCheck } from 'lucide-react'

import { ApiError } from '../lib/http'
import { useAuth } from '../lib/auth'
import { Button, PasswordInput } from '../components/ui'

export function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const { state } = useLocation() as { state: { from?: string } | null }

  // Either a full address or a bare username — the server resolves it. Named
  // `identifier` rather than `email` so the input's type and validation are not
  // quietly tightened back to an address later.
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(identifier, password)
      // Deep-linked users go back where they were heading; everyone else lands
      // on the app's primary action.
      nav(state?.from ?? '/create', { replace: true })
    } catch (err) {
      // The server returns one generic message for wrong password, unknown
      // account, disabled and locked alike, so we must not embellish it here.
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : err instanceof Error
            ? err.message
            : 'Sign in failed.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={submit} className="card p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy-lit/15 text-brand-navy-lit">
            <LogIn size={18} />
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Staff sign in</h1>
            <p className="text-xs text-muted">Genetech Solutions internal</p>
          </div>
        </div>

        <label htmlFor="identifier" className="mb-2 block text-sm font-semibold">
          Username or work email
        </label>
        <input
          id="identifier"
          // NOT type="email" — that would make the browser reject a bare
          // username before the request is ever sent.
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          placeholder="username"
          className="mb-1.5 w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm focus:border-brand-navy-lit focus:outline-none"
        />
        <p className="mb-4 text-xs text-muted">
          Your Windows username is enough — or type the full address.
        </p>

        <label htmlFor="pw" className="mb-2 block text-sm font-semibold">
          Password
        </label>
        <PasswordInput
          id="pw"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // A password manager is welcome here, unlike on the secret field where
          // autofill would be actively harmful.
          autoComplete="current-password"
          required
          wrapperClassName="mb-5"
        />

        {error && (
          <p className="mb-4 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy || !identifier || !password} className="w-full">
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Signing in...
            </span>
          ) : (
            'Sign in'
          )}
        </Button>

        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted">
          <ShieldCheck size={13} />
          Accounts are created by an administrator. There is no self-service signup.
        </p>
      </form>
    </div>
  )
}
