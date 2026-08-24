import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { SESSION_EXPIRED } from './http'
import { staffApi, type Me } from './api-staff'
import { forget, needsPassword, unlock } from './vault'

/**
 * Staff session state.
 *
 * This module exists ONLY in the staff bundle. It replaces Phase 1's
 * ensureSession(), which ran on every route - including the client-facing
 * reveal page - and minted an anonymous identity for anyone who opened a link.
 * Nothing here runs for an external recipient, because none of it is shipped to
 * them.
 */

interface AuthState {
  user: Me | null
  loading: boolean
  /** The stored key could not be opened with the password just used — under AD
   *  this means the domain password changed. The UI offers to migrate it. */
  keyNeedsMigration: boolean
  /** The password from this sign-in, held in memory ONLY while a migration is
   *  pending, because re-wrapping needs the CURRENT password as the target.
   *  Never persisted anywhere. */
  sessionPassword: string | null
  clearMigration: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyNeedsMigration, setKeyNeedsMigration] = useState(false)
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setUser(await staffApi.me())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The api layer raises this only for staff paths. A 401 from the reveal
  // endpoint means a wrong passphrase, not an expired session.
  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener(SESSION_EXPIRED, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired)
  }, [])

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => {
      const me = await staffApi.login(email, password)

      // Sign-in is the only moment the password is in hand, so it is the only
      // moment the private key can be unwrapped.
      //
      // Whether a key that will not open should be REPLACED depends on why:
      //
      //   local account — the password only ever changes through our own form,
      //     which re-wraps in the same request. So a failure here means the key
      //     is genuinely orphaned (an admin resetpw) and rotating is right.
      //
      //   AD account — the password changes at the Windows lock screen, and the
      //     app never saw the old one. A failure here almost always means "the
      //     domain password changed", NOT "the key is dead". Rotating would
      //     destroy every pending client reply, routinely. So: do not rotate.
      //     Offer to migrate the key instead.
      const isAd = me.auth_source === 'ad'
      await unlock(password, !isAd).catch(() => {})
      setKeyNeedsMigration(isAd && needsPassword())
      setSessionPassword(isAd && needsPassword() ? password : null)
      setUser(me)
    },
    keyNeedsMigration,
    sessionPassword,
    clearMigration: () => {
      setKeyNeedsMigration(false)
      setSessionPassword(null)
    },
    logout: async () => {
      await staffApi.logout().catch(() => {})
      forget()
      setSessionPassword(null)
      setKeyNeedsMigration(false)
      setUser(null)
    },
    logoutAll: async () => {
      await staffApi.logoutAll().catch(() => {})
      forget()
      setSessionPassword(null)
      setKeyNeedsMigration(false)
      setUser(null)
    },
    refresh,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth used outside AuthProvider')
  return ctx
}

function Spinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-brand-navy-lit" size={28} />
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  // A freshly provisioned account cannot do anything until it rotates the
  // operator-issued password. The backend enforces this too, with a 403.
  if (user.must_change_password && location.pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />
  }
  return <>{children}</>
}

/** RequireAuth plus the admin flag. The backend enforces this independently
 *  with a 403 — this only avoids rendering a page that would fail to load. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!user.is_admin) return <Navigate to="/create" replace />
  return <>{children}</>
}
