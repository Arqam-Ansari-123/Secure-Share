import { SearchX } from 'lucide-react'

/**
 * The catch-all route.
 *
 * Split out of Gone.tsx deliberately: Gone's classify() falls back to 'expired'
 * and the catch-all passes no state, so every mistyped URL used to tell the
 * visitor their secret had expired. That is actively misleading — it sends
 * someone chasing a sender for a "new link" when they simply lost part of the
 * one they have.
 *
 * The truncation hint matters: the decryption key lives after the #, and mail
 * clients and chat apps are the usual culprits for clipping it.
 */
export function NotFound() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8 text-center sm:p-10">
        <SearchX size={34} className="mx-auto mb-5 text-muted" />
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight">Link not found</h1>
        <p className="text-sm leading-relaxed text-muted">
          We have no record of this link. Check that it was copied in full — including everything
          after the <code className="font-mono text-paper">#</code>, which some mail and chat apps
          cut off — or ask the sender to issue a new one.
        </p>
      </div>
    </div>
  )
}
