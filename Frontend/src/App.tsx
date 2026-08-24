import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { PublicShell } from './components/PublicShell'
import { purgeLegacySession } from './lib/api'
import { Gone } from './pages/Gone'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { RequestSubmit } from './pages/RequestSubmit'
import { Reveal } from './pages/Reveal'

/**
 * Build-time surface constant. Vite substitutes it as a literal, so the staff
 * branch below is statically dead in the public build and Rollup removes the
 * whole staff module from that bundle.
 *
 *   npm run build:public   ->  dist/public   (what clients get)
 *   npm run build:staff    ->  dist/staff    (internal host only)
 */
const STAFF = import.meta.env.VITE_SURFACE === 'staff'

// The ternary matters. Written as an unconditional
// `lazy(() => import('./routes/staff'))` the import expression stays reachable
// at module scope, and Rollup emits the staff chunk into the PUBLIC bundle even
// though the branch using it is dead. Guarding the expression itself lets the
// constant fold to null and the whole module drop out.
const StaffRoutes = STAFF ? lazy(() => import('./routes/staff')) : null

export default function App() {
  // Phase 1 called ensureSession() here, on EVERY route — which minted a
  // year-long identity for every external client who opened a link. There is
  // deliberately no session bootstrap now; this only clears the leftover value
  // from browsers that already have one.
  useEffect(() => {
    purgeLegacySession()
  }, [])

  if (STAFF && StaffRoutes) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center">
            <Loader2 className="animate-spin text-brand-navy-lit" size={28} />
          </div>
        }
      >
        <StaffRoutes />
      </Suspense>
    )
  }

  // ---- public surface: reveal a secret, and nothing else --------------------
  return (
    <Routes>
      {(
        [
          ['/', <Landing key="h" />],
          // Outbound: opening a secret we sent them.
          ['/s/:token', <Reveal key="r" />],
          // Inbound: answering a credential request we sent them. Public by
          // necessity — clients have no account. The request token is the
          // authorization.
          ['/r/:token', <RequestSubmit key="rs" />],
          ['/gone', <Gone key="g" />],
          ['*', <NotFound key="nf" />],
        ] as const
      ).map(([path, el]) => (
        <Route key={path} path={path} element={<PublicShell>{el}</PublicShell>} />
      ))}
    </Routes>
  )
}
