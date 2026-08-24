import type { ReactNode } from 'react'

// Cropped + reversed wordmark — see the note in AppShell.tsx. It matters most on
// this page: an external client decides whether to paste a credential largely on
// whether the branding looks genuine, and the old inverted version showed them a
// peach-and-cyan logo that is not Genetech's.
import logoWithName from '../../Assets/logo-wordmark-dark.png'
import logoMark from '../../Assets/logo.png'

/**
 * The layout an external client sees.
 *
 * Branded, because someone receiving a credential needs to believe the page is
 * genuinely Genetech's — and a dead end, because they are not a user of this
 * tool. There is no <nav>, and the wordmark is deliberately NOT a link: a
 * client-facing page should carry no navigation affordance at all. The only way
 * out is genetechsolutions.com in the footer.
 *
 * In Phase 1 the reveal page rendered inside the staff shell, so a client saw
 * "Create secret" and "Dashboard" and could click straight into the internal
 * app. This file is the fix.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="aurora" aria-hidden />

      <header className="pt-6">
        <div className="mx-auto flex max-w-3xl items-center justify-center px-4">
          <img
            src={logoWithName}
            alt="Genetech Solutions"
            className="h-12 w-auto sm:h-14"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">{children}</main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-12">
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
