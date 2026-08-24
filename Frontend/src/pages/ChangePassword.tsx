import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Loader2 } from 'lucide-react'

import { ApiError } from '../lib/http'
import { staffApi, type WrappedKeys } from '../lib/api-staff'
import { rewrap } from '../lib/keys'
import { unlock } from '../lib/vault'
import { useAuth } from '../lib/auth'
import { Button } from '../components/ui'

export function ChangePassword() {
  const { user, refresh } = useAuth()
  const nav = useNavigate()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyWarning, setKeyWarning] = useState(false)

  const forced = user?.must_change_password ?? false

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== confirm) {
      setError('The two new passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await staffApi.changePassword(current, next)

      // The private key is wrapped under the OLD password, so it must be
      // re-wrapped now — this is the only moment both passwords are available.
      // Skip it and every pending credential request becomes unreadable.
      try {
        const keys = await staffApi.getKeys()
        if (keys.pubkey) {
          await staffApi.putKeys(await rewrap(keys as WrappedKeys, current, next))
        }
        await unlock(next)
      } catch {
        setKeyWarning(true)
      }

      // Changing a password signs out every OTHER device but keeps this one,
      // so refresh the profile rather than bouncing to the login page.
      await refresh()
      nav('/create', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Could not change password.',
      )
      setBusy(false)
    }
  }

  const FIELDS = [
    {
      id: 'cur',
      label: forced ? 'Temporary password' : 'Current password',
      v: current,
      set: setCurrent,
      ac: 'current-password',
    },
    { id: 'new', label: 'New password', v: next, set: setNext, ac: 'new-password' },
    { id: 'cnf', label: 'Confirm new password', v: confirm, set: setConfirm, ac: 'new-password' },
  ]

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={submit} className="card p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red/12 text-brand-red-hot">
            <KeyRound size={18} />
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              {forced ? 'Set your password' : 'Change password'}
            </h1>
            <p className="text-xs text-muted">
              {forced
                ? 'Your account was created with a temporary password. Choose your own to continue.'
                : 'Signs you out of every other device.'}
            </p>
          </div>
        </div>

        {FIELDS.map((f) => (
          <div key={f.id}>
            <label htmlFor={f.id} className="mb-2 block text-sm font-semibold">
              {f.label}
            </label>
            <input
              id={f.id}
              type="password"
              value={f.v}
              onChange={(e) => f.set(e.target.value)}
              autoComplete={f.ac}
              required
              className="mb-4 w-full rounded-xl border border-white/10 bg-ink-950/60 p-3 font-mono text-sm focus:border-brand-navy-lit focus:outline-none"
            />
          </div>
        ))}

        <p className="mb-4 text-xs text-muted">
          At least 12 characters, with 5 or more distinct ones.
        </p>

        {keyWarning && (
          <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            Your password changed, but your encryption key could not be moved across. Any credential
            request still awaiting a reply may be unreadable. New requests will work normally.
          </p>
        )}

        {error && (
          <p className="mb-4 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy || !current || !next || !confirm} className="w-full">
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Saving...
            </span>
          ) : (
            'Save password'
          )}
        </Button>
      </form>
    </div>
  )
}
