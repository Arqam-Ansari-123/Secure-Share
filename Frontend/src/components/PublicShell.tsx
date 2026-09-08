import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Vector reversed wordmark — see the note in AppShell.tsx. Sharpness matters
// most on this page: an external client decides whether to paste a credential
// largely on whether the branding looks genuine, and this header renders the
// logo larger than the staff one, which is precisely where the old 375x134 PNG
// was being upscaled and going soft.
import logoWithName from '../../Assets/genetech-wordmark-dark.svg'
import logoMark from '../../Assets/logo.png'

/**
 * The layout an external client sees.
 *
 * Branded, because someone receiving a credential needs to believe the page is
 * genuinely Genetech's — and close to a dead end, because they are not a user
 * of this tool. There is no <nav>.
 *
 * The wordmark links to "/" and nowhere else. It previously linked nowhere at
 * all, which left anyone landing on /gone with no way forward. "/" on THIS
 * surface is the public landing page, which is client-safe by construction —
 * the staff bundle is not in this build, so there is nothing internal to reach.
 * The original worry was Phase 1, when the reveal page rendered inside the
 * staff shell and the logo led straight into the internal app.
 *
 * In Phase 1 the reveal page rendered inside the staff shell, so a client saw
 * "Create secret" and "Dashboard" and could click straight into the internal
 * app. This file is the fix.
 */
export function PublicShell({
  children,
  wide = false,
}: {
  children: ReactNode
  /**
   * Landing brings its OWN `max-w-6xl` sections and horizontal padding, so the
   * shell must get out of its way — clamped to max-w-3xl it renders as a narrow
   * column with dead space either side on any normal screen. That is the bug
   * this prop fixes.
   *
   * Every other public page (Reveal, RequestSubmit, Gone, NotFound) is a single
   * narrow card that sets its own max-w-lg/2xl and relies on this shell for
   * padding, so they stay on the default.
   */
  wide?: boolean
}) {
  // Header and footer follow the same width as the content, or the footer rule
  // would be visibly narrower than the page it sits under.
  const gutter = wide ? 'max-w-6xl' : 'max-w-3xl'
  return (
    <>
      <div className="aurora" aria-hidden />

      {/* Sticky so the branding stays put, with a blurred scrim behind it so
          page content does not scroll through it crisply. */}
      <header className="sticky top-0 z-50 pt-5 pb-3 sm:pt-6">
        <div
          className="header-scrim pointer-events-none absolute inset-0"
          aria-hidden
        />
        <div className={`relative mx-auto flex ${gutter} items-center justify-center px-4 sm:px-6`}>
          <Link
            to="/"
            aria-label="SecureShare home"
            className="rounded-lg transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand-navy-lit focus-visible:outline-none"
          >
            <img
              src={logoWithName}
              alt="Genetech Solutions"
              className="h-11 w-auto sm:h-16"
            />
          </Link>
        </div>
      </header>

      <main className={wide ? "w-full" : "mx-auto w-full max-w-3xl px-4 py-12 sm:py-16"}>
        {children}
      </main>

      <footer className={`mx-auto w-full ${gutter} px-4 pb-12 sm:px-6`}>
        <div className="flex flex-col items-center gap-3 border-t border-white/8 pt-8 text-center text-sm text-muted">
          <img src={logoMark} alt="" className="h-6 w-6 opacity-70" aria-hidden />
          <p>
            SecureShare — by{' '}
            <a
              href="https://www.genetechsolutions.com/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-paper underline decoration-brand-red/60 underline-offset-4 hover:decoration-brand-red"
            >
              Genetech Solutions
            </a>
          </p>
          <p className="font-mono text-xs">
            Encrypted in your browser · never readable by our servers
          </p>
        </div>
      </footer>
    </>
  )
}
