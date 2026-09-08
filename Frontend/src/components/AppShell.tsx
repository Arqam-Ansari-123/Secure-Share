import { useCallback, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Menu,
  MonitorSmartphone,
  ShieldCheck,
  X,
} from 'lucide-react'

import { useDismissOnOutside } from './ui'
import { useAuth } from '../lib/auth'
// SVG, not PNG. The raster wordmark was only 375x134 — at the 44px header size
// that is exactly at the limit for a 3x display, and the public header rendered
// it at 56px, i.e. upscaled and visibly soft. A vector has no such ceiling.
//
// The `-dark` variant is the supplied brand SVG with the wordmark lettering
// recoloured to paper white for our dark surfaces. The brand red (#C53B27) is
// untouched. It is a real recolour in the asset, NOT a CSS filter: `invert()`
// was tried once and it does not lighten a logo, it rotates every hue — navy
// came out peach and the brand red came out CYAN. So NO filter belongs on this.
//
// `GenetechSolutions Logo.svg` (navy wordmark) stays in Assets/ for light
// backgrounds, along with the old PNGs.
import logoWithName from '../../Assets/genetech-wordmark-dark.svg'
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
  const [navOpen, setNavOpen] = useState(false)

  // useCallback so the hook's effect does not tear down and re-subscribe on
  // every render of the shell.
  const close = useCallback(() => setOpen(false), [])
  const closeNav = useCallback(() => setNavOpen(false), [])
  // Wraps the trigger AND the panel, so clicking the trigger is "inside".
  const menuRef = useDismissOnOutside<HTMLDivElement>(open, close)
  const navRef = useDismissOnOutside<HTMLDivElement>(navOpen, closeNav)

  // Built once and rendered twice -- inline on desktop, in the drawer on
  // mobile -- so the two can never drift apart.
  const links = [...NAV, ...(user?.is_admin ? ADMIN_NAV : [])]

  async function signOut(everywhere: boolean) {
    setOpen(false)
    await (everywhere ? logoutAll() : logout())
    nav('/login', { replace: true })
  }

  return (
    <>
      <div className="aurora" aria-hidden />

      <header className="sticky top-0 z-50">
        {/* The nav is a floating pill with a margin above it, so without this
            the page scrolls through that gap perfectly sharp and appears to
            collide with the header. Extends past the pill and fades out. */}
        <div
          className="header-scrim pointer-events-none absolute inset-x-0 top-0 h-[calc(100%+1.25rem)]"
          aria-hidden
        />
        {/* Gutter matching <main>'s px-4 sm:px-6. Without it the pill is
            mx-auto max-w-6xl with nothing outside it, so on any screen narrower
            than 6xl it runs edge to edge while the content below sits inset --
            the rounded corners end up flush against the viewport. The scrim
            stays OUTSIDE this wrapper so the blur band remains full-bleed. */}
        <div className="relative px-4 sm:px-6">
          <div className="glass mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl px-3 py-2.5 sm:px-6 sm:py-3">
          {/* Standard convention: the wordmark goes home, not to the app.
              Home is /home because / now opens straight onto /create. */}
          <Link to="/home" className="flex items-center gap-3" aria-label="SecureShare home">
            {/* Cropped, the wordmark is 2.8:1 rather than square, so it is much
                WIDER at a given height than the old padded asset. The nav now
                collapses into a drawer below md, so this no longer has to share
                the row with five links on a phone. */}
            <img
              src={logoWithName}
              alt="Genetech Solutions"
              className="h-9 w-auto sm:h-12"
            />
            <span className="hidden h-5 w-px bg-white/15 sm:block" aria-hidden />
            <span className="hidden font-mono text-xs tracking-[0.18em] text-muted uppercase sm:block">
              SecureShare
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {/* Desktop: inline. Five links plus the wordmark and the account
                button need ~640px, so below md they move into the drawer. */}
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((n) => (
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

            {/* Mobile: the same links in a dropdown. */}
            <div className="relative md:hidden" ref={navRef}>
              <button
                type="button"
                onClick={() => setNavOpen((o) => !o)}
                className="flex cursor-pointer items-center justify-center rounded-lg p-2 text-muted transition hover:bg-white/6 hover:text-paper"
                aria-expanded={navOpen}
                aria-haspopup="menu"
                aria-label={navOpen ? 'Close menu' : 'Open menu'}
              >
                {navOpen ? <X size={20} /> : <Menu size={20} />}
              </button>

              {navOpen && (
                <div role="menu" className="menu-panel absolute right-0 mt-2 w-52 overflow-hidden p-1.5 text-sm">
                  {links.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      role="menuitem"
                      onClick={closeNav}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2.5 font-semibold transition ${
                          isActive
                            ? 'bg-white/10 text-paper'
                            : 'text-muted hover:bg-white/6 hover:text-paper'
                        }`
                      }
                    >
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>

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
                    className="menu-panel absolute right-0 mt-2 w-60 max-w-[calc(100vw-1.5rem)] overflow-hidden p-1.5 text-sm"
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">{children}</main>

      <footer className="mx-auto mt-16 w-full max-w-6xl px-4 pb-10 sm:px-6">
        <div className="flex flex-col items-center gap-4 border-t border-white/8 pt-8 text-sm text-muted sm:flex-row sm:justify-between">
          {/* text-center matters on mobile: the string wraps to two lines, and
              without it the wrapped half sits ragged-left against a centred
              container. Reverts to left once it fits on one line. */}
          <div className="flex items-center gap-3 text-center sm:text-left">
            <img src={logoMark} alt="" className="h-6 w-6 shrink-0" aria-hidden />
            <span>
              SecureShare —{' '}
              <a
                href="https://www.genetechsolutions.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-paper underline decoration-brand-red/60 underline-offset-4 transition hover:decoration-brand-red"
              >
                Genetech Solutions
              </a>{' '}
              internal
            </span>
          </div>
          <p className="flex items-center gap-2 font-mono text-xs">
            <ShieldCheck size={13} /> Encrypted in your browser
          </p>
        </div>
      </footer>
    </>
  )
}
