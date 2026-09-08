import { useState } from 'react'
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'

import { useAuth } from '../lib/auth'
import { abandonKey, migrateKey } from '../lib/vault'
import { Button, PasswordInput } from './ui'

/**
 * Shown when the stored private key will not open with the password just used.
 *
 * For a domain account that almost always means one thing: the password was
 * changed at the Windows lock screen, so the key is still wrapped under the old
 * one. The key is fine — it just needs moving across, and only the user can do
 * that, because only they know the previous password.
 *
 * The alternative is issuing a fresh keypair, which is offered but never taken
 * automatically: it would quietly destroy every client reply still awaiting
 * collection, and under a 90-day domain policy that would happen routinely.
 */
export function KeyMigration() {
  const { keyNeedsMigration, sessionPassword, clearMigration, user } = useAuth()
  const [oldPassword, setOldPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)

  if (!keyNeedsMigration || !sessionPassword) return null

  async function migrate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    if (await migrateKey(oldPassword, sessionPassword!)) {
      clearMigration()
    } else {
      setError('That password did not open your key. Check it and try again.')
      setBusy(false)
    }
  }

  async function startOver() {
    setBusy(true)
    await abandonKey(sessionPassword!)
    clearMigration()
  }

  return (
    <div className="card mb-6 border-amber-400/30 bg-amber-400/5 p-5">
      <div className="mb-3 flex items-center gap-3">
        <KeyRound size={18} className="text-amber-300" />
        <p className="text-sm font-semibold">Your encryption key needs moving across</p>
      </div>

      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-muted">
        {user?.auth_source === 'ad'
          ? 'Your Windows password has changed since you last used SecureShare. Your key is still locked with the previous one — enter it once and we will move it across.'
          : 'Your key is locked with a previous password. Enter it once and we will move it across.'}{' '}
        Until then you can send secrets and create requests as normal, but you cannot read replies
        clients have already sent.
      </p>

      {!confirmingReset ? (
        <form onSubmit={migrate} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="oldpw" className="mb-2 block text-xs font-semibold text-muted">
              Your previous password
            </label>
            <PasswordInput
              id="oldpw"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="off"
              wrapperClassName="max-w-sm"
            />
          </div>
          <Button type="submit" disabled={busy || !oldPassword}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : 'Move my key'}
          </Button>
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            className="cursor-pointer px-2 py-3 text-xs font-semibold text-muted underline underline-offset-4 hover:text-paper"
          >
            I don&apos;t remember it
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-brand-red/30 bg-brand-red/10 p-4">
          <p className="mb-3 flex items-start gap-2 text-sm text-red-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Starting over issues a new key. Any credential a client has already sent, and not yet
            collected, becomes permanently unreadable — they would need to send it again. Requests
            you create from now on will work normally.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void startOver()} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Issue a new key'}
            </Button>
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-muted hover:text-paper"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-brand-red/30 bg-brand-red/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
