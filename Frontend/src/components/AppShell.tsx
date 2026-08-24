import { useCallback, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react'

import { useDismissOnOutside } from './ui'
import { useAuth } from '../lib/auth'
// Two problems with the original `logo with name.png`, both fixed in the asset
// rather than in CSS:
//
//  1. It is a 447x447 SQUARE canvas holding a 375x134 wordmark, so 70% of its
//     height was transparent padding — at h-8 the lettering rendered under 10px
//     tall. logo-wordmark.png is the same artwork cropped to its content.
//
//  2. It is drawn in Genetech navy for a light page. The old fix here was
//     `invert-[0.92] brightness-125`, but inverting does not lighten a logo, it
//     rotates every hue: navy #104a68 came out pale peach and the brand red came
//     out CYAN. logo-wordmark-dark.png is a proper reversed lockup — white
//     wordmark, brand red #b93e2e untouched — so NO filter belongs on it.
//
// Both originals are still in Assets/ for light-background use.
import logoWithName from '../../Assets/logo-wordmark-dark.png'
import logoMark from '../../Assets/logo.png'

const NAV = [
  { to: '/home', label: 'Home' },
  // The two things an employee can do: send a credential, or ask for one.
  { to: '/create', label: 'Send secret' },
  { to: '/requests', label: 'Request' },
  { to: '/dashboard', label: 'Dashboard' },
]

/** Administrators only — the company-wide activity log. */
const ADMIN_NAV = [{ to: '/admin/activity', label: 'Activity' }]

/**
 * The staff layout. Renamed from Shell.tsx, and it now carries the nav that
 * used to leak onto client-facing pages — see PublicShell for that half.
 *
 * The old `bare` prop is gone: it only ever changed <main> padding, which is
 * why it never actually hid anything.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, logoutAll } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)

  // useCallback so the hook's effect does not tear down and re-subscribe on
  // every render of the shell.
  const close = useCallback(() => setOpen(false), [])
  // Wraps the trigger AND the panel, so clicking the trigger is "inside".
  const menuRef = useDismissOnOutside<HTMLDivElement>(open, close)

  async function signOut(everywhere: boolean) {
    setOpen(false)
    await (everywhere ? logoutAll() : logout())
    nav('/login', { replace: true })
  }

  return (
    <>
      <div className="aurora" aria-hidden />

      <header className="sticky top-0 z-50">
        <div className="glass mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl px-4 py-3 sm:px-6">
          {/* Standard convention: the wordmark goes home, not to the app.
              Home is /home because / now opens straight onto /create. */}
          <Link to="/home" className="flex items-center gap-3" aria-label="SecureShare home">
            {/* Cropped, the wordmark is 2.8:1 rather than square, so it is much
                WIDER at a given height than the old padded asset. Stepped up at
                the sm breakpoint because the nav links share this row and have
                no mobile menu to collapse into. Both steps are >3x the old
                legible size. */}
            <img
              src={logoWithName}
              alt="Genetech Solutions"
              className="h-9 w-auto sm:h-11"
            />
            <span className="hidden h-5 w-px bg-white/15 sm:block" aria-hidden />
            <span className="hidden font-mono text-xs tracking-[0.18em] text-muted uppercase sm:block">
              SecureShare
            </span>
          </Link>

          <div className="flex items-center gap-1">
            <nav className="flex items-center gap-1">
              {[...NAV, ...(user?.is_admin ? ADMIN_NAV : [])].map((n) => (
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

            {user && (
              <div className="relative ml-1" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:bg-white/6 hover:text-paper"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  aria-label={`Account menu for ${user.display_name}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-navy-lit/25 text-xs font-bold text-sky-200">
                    {user.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline">{user.display_name}</span>
                  {user.is_admin && (
                    <span className="hidden rounded bg-brand-red/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300 sm:inline">
                      ADMIN
                    </span>
                  )}
                  <ChevronDown size={14} />
                </button>

                {open && (
                  <div
                    role="menu"
                    className="card absolute right-0 mt-2 w-60 overflow-hidden p-1.5 text-sm"
                  >
                    <p className="px-3 py-2 font-mono text-xs break-all text-muted">{user.email}</p>
                    {/* An AD user's password lives in the domain; the local
                        form would only reject them. */}
                    {user.auth_source === 'ad' ? (
                      <p className="px-3 py-2 text-xs text-muted">
                        Password managed by Active Directory
                      </p>
                    ) : (
                      <Link
                        to="/account/password"
                        role="menuitem"
                        onClick={close}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-white/8"
                      >
                        <KeyRound size={14} /> Change password
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut(false)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/8"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut(true)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-red-300 transition hover:bg-brand-red/12"
                    >
                      <MonitorSmartphone size={14} /> Sign out everywhere
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">{children}</main>

      <footer className="mx-auto mt-16 w-full max-w-6xl px-4 pb-10 sm:px-6">
        <div className="flex flex-col items-center gap-4 border-t border-white/8 pt-8 text-sm text-muted sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <img src={logoMark} alt="" className="h-6 w-6" aria-hidden />
            <span>SecureShare — Genetech Solutions internal</span>
          </div>
          <p className="flex items-center gap-2 font-mono text-xs">
            <ShieldCheck size={13} /> Encrypted in your browser
          </p>
        </div>
      </footer>
    </>
  )
}
