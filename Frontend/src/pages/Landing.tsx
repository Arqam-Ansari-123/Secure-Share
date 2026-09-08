import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, EyeOff, FileLock2, Flame, KeyRound, ScrollText, Timer } from 'lucide-react'

/** Build-time surface flag — see App.tsx. Lets the bundler drop the branch
 *  that does not apply, so the public build ships no staff links. */
const STAFF = import.meta.env.VITE_SURFACE === 'staff'

import { Tagline } from '../components/Tagline'
import { SectionTitle, TiltCard } from '../components/ui'

// The three.js chunk is ~150 KB gzipped and only this page needs it.
const Hero3D = lazy(() => import('../components/Hero3D').then((m) => ({ default: m.Hero3D })))

const STEPS = [
  {
    icon: FileLock2,
    title: 'Encrypted before it leaves you',
    body: 'Your browser seals the secret with AES-GCM. The key is generated locally and placed in the link fragment — the part of a URL browsers never transmit.',
  },
  {
    icon: EyeOff,
    title: 'Stored blind',
    body: 'Our server receives ciphertext and nothing else. There is no key on our side, so there is nothing for us to hand over, leak, or misuse.',
  },
  {
    icon: Flame,
    title: 'Destroyed on read',
    body: 'The first successful view removes it atomically at the database level with a single GETDEL. The second visitor gets an expiry page, not a copy.',
  },
]

const PROOF = [
  { icon: KeyRound, k: 'AES-GCM 256', v: 'sealed in your browser' },
  { icon: Timer, k: 'Redis TTL', v: 'auto-expiry, even if never opened' },
  { icon: ScrollText, k: 'Append-only', v: 'audit rows cannot be edited or deleted' },
]

export function Landing() {
  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-2 lg:gap-4 lg:pt-16">
        {/* min-w-0 is load-bearing. A grid item defaults to min-width:auto, so
            it refuses to shrink below its widest unbreakable child -- here the
            Tagline, whose line is an inline-block and therefore one rigid unit
            as wide as the whole string. That pushed this column past the
            viewport and clipped the paragraph off the right edge. It was always
            broken; content-sized buttons just hid it until they went full
            width. */}
        <div className="min-w-0">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs tracking-widest text-muted uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-red" aria-hidden />
            Genetech Solutions
          </p>

          {/* Solid colour, not a gradient: "exactly once" is the product promise,
              and the red is doing semantic work here — it is the same red used
              for every destructive state in the app. */}
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Share a secret
            <br />
            <span className="text-brand-red-hot">exactly once.</span>
          </h1>

          <div className="mt-6 h-14">
            <Tagline />
          </div>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Passwords, API keys and credentials do not belong in email or chat, where they sit
            forever in someone's history. Send a link that works one time and then stops existing.
          </p>

          {/* The same page serves both audiences, so the ending differs.
              STAFF build: real actions. PUBLIC build: no call to action at all,
              and deliberately no sign-in link — that would put the internal
              hostname into a bundle every client downloads. STAFF is a
              build-time constant, so the branch not taken is removed entirely
              and the client never receives these links. */}
          {/* Column + stretch on mobile so both CTAs are the SAME width and fill
              the measure; they were inline-flex in a wrap row, so each sized to
              its own label and they landed ragged. Row again from sm up. */}
          {STAFF ? (
            <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                to="/create"
                className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-red px-6 py-3.5 font-semibold text-white shadow-[0_16px_40px_-16px] shadow-brand-red transition hover:bg-brand-red-hot"
              >
                Create a secret
                <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/dashboard"
                className="glass inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold transition hover:bg-white/10"
              >
                View my secrets
              </Link>
            </div>
          ) : (
            <div className="mt-9 rounded-xl border border-white/10 bg-white/4 p-4">
              <p className="text-sm leading-relaxed text-muted">
                <span className="font-semibold text-paper">Were you sent a link?</span> Open the link
                you were given — it takes you straight to your secret. This page has nothing to
                collect and nothing to sign in to.
              </p>
            </div>
          )}
        </div>

        <div className="relative h-[260px] sm:h-[420px] lg:h-[560px]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="h-24 w-24 animate-pulse rounded-full bg-brand-red/20" />
              </div>
            }
          >
            <Hero3D />
          </Suspense>
        </div>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <SectionTitle
          kicker="How it works"
          title="Three steps, one of them irreversible"
          sub="The design goal was not to promise we would keep your secret safe. It was to make it impossible for us to read in the first place."
        />
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <TiltCard key={s.title}>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red/12 text-brand-red-hot">
                  <s.icon size={19} />
                </span>
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
              </div>
              <h3 className="mb-2 text-lg font-bold">{s.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
            </TiltCard>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ proof */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <div className="card overflow-hidden p-8 sm:p-10">
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                We cannot read your secret.
                <br />
                <span className="text-muted">That is a property of the maths, not a policy.</span>
              </h2>
              <p className="mt-4 leading-relaxed text-muted">
                The decryption key lives in the <code className="font-mono text-paper">#fragment</code> of your
                link. Browsers never send fragments to servers — not to us, not through a proxy, not in a
                referrer header. Every audit entry we keep records who opened what and when, and never a byte
                of what was inside.
              </p>
            </div>
            <ul className="space-y-3">
              {PROOF.map((p) => (
                <li key={p.k} className="flex items-center gap-4 rounded-xl bg-white/4 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-navy-lit/15 text-brand-navy-lit">
                    <p.icon size={17} />
                  </span>
                  <div>
                    <p className="font-mono text-sm font-semibold text-paper">{p.k}</p>
                    <p className="text-sm text-muted">{p.v}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
