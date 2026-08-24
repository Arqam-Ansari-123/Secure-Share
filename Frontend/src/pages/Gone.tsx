import { useLocation } from 'react-router-dom'
import { Ban, Clock, Flame, SearchX } from 'lucide-react'

/** Four genuinely different situations. Telling them apart is the whole point —
 *  "expired" and "someone already opened this" mean very different things to a
 *  person waiting on a credential. Tone stays calm: the common case is not an
 *  incident, it is the product working. */
const CASES = {
  viewed: {
    icon: Flame,
    title: 'Already opened',
    body: 'This secret was viewed and destroyed. Secrets can only be opened once — if that was not you, treat the credential as compromised and rotate it.',
    tone: 'text-brand-red-hot',
  },
  expired: {
    icon: Clock,
    title: 'Expired',
    body: 'This secret reached its time limit before anyone opened it, so it was deleted automatically. Ask the sender for a fresh link.',
    tone: 'text-muted',
  },
  revoked: {
    icon: Ban,
    title: 'Revoked by the sender',
    body: 'The sender withdrew this secret before it was opened. Nothing was disclosed.',
    tone: 'text-brand-red-hot',
  },
  destroyed: {
    icon: Flame,
    title: 'Destroyed after failed attempts',
    body: 'Too many incorrect passphrases were entered, so this secret was destroyed as a precaution. Nobody saw its contents.',
    tone: 'text-brand-red-hot',
  },
  unknown: {
    icon: SearchX,
    title: 'Link not found',
    body: 'We have no record of this link. Check that it was copied in full — including everything after the # — or ask the sender to resend it.',
    tone: 'text-muted',
  },
} as const

function classify(reason?: string): keyof typeof CASES {
  const r = (reason ?? '').toLowerCase()
  if (r.includes('viewed')) return 'viewed'
  if (r.includes('revoked')) return 'revoked'
  if (r.includes('destroyed') || r.includes('attempt')) return 'destroyed'
  if (r.includes('expired')) return 'expired'
  if (r.includes('unknown') || r.includes('not found')) return 'unknown'
  // Reached only when the server sent a terminal status we don't recognise.
  // Genuine 404s now render NotFound instead — this page used to be the
  // catch-all, which meant every mistyped URL claimed the secret had expired.
  return 'expired'
}

export function Gone() {
  const { state } = useLocation() as { state: { reason?: string } | null }
  const c = CASES[classify(state?.reason)]

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8 text-center sm:p-10">
        <c.icon size={34} className={`mx-auto mb-5 ${c.tone}`} />
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight">{c.title}</h1>
        <p className="text-sm leading-relaxed text-muted">{c.body}</p>
        {/* No call to action. This page is shown to external clients, and the
            previous "Send a secret of your own" button walked them straight
            into the internal create form. */}
      </div>
    </div>
  )
}
