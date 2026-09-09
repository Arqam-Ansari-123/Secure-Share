import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

// NOTE: this file is no longer imported anywhere — AppShell.tsx replaced it and
// PublicShell.tsx took over the client-facing half. Kept in step with them so it
// is not misleading if anyone opens it, but it is a candidate for deletion.
import logoWithName from '../../Assets/logo-wordmark-dark.png'
import logoMark from '../../Assets/icon.svg'

const NAV = [
  { to: '/create', label: 'Create secret' },
  { to: '/dashboard', label: 'Dashboard' },
]

export function Shell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return (
    <>
      <div className="aurora" aria-hidden />

      <header className="sticky top-0 z-50">
        <div className="glass mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3" aria-label="SecureShare by Genetech Solutions — home">
            {/* Reversed lockup: white wordmark, brand red mark. No CSS filter —
                inverting rotated the brand hues instead of lightening them. */}
            <img src={logoWithName} alt="Genetech Solutions" className="h-9 w-auto sm:h-11" />
            <span className="hidden h-5 w-px bg-white/15 sm:block" aria-hidden />
            <span className="hidden font-mono text-xs tracking-[0.18em] text-muted uppercase sm:block">
              SecureShare
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isActive ? 'bg-white/10 text-paper' : 'text-muted hover:bg-white/6 hover:text-paper'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className={bare ? '' : 'mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16'}>{children}</main>

      <footer className="mx-auto mt-16 w-full max-w-6xl px-4 pb-10 sm:px-6">
        <div className="flex flex-col items-center gap-4 border-t border-white/8 pt-8 text-sm text-muted sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <img src={logoMark} alt="" className="h-6 w-auto" aria-hidden />
            <span>
              SecureShare — built by{' '}
              <a
                href="https://www.genetechsolutions.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-paper underline decoration-brand-red/60 underline-offset-4 hover:decoration-brand-red"
              >
                Genetech Solutions
              </a>
            </span>
          </div>
          <p className="font-mono text-xs">Encrypted in your browser · never readable by our servers</p>
        </div>
      </footer>
    </>
  )
}
