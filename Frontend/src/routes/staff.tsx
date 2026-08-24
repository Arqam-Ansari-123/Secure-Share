import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { PublicShell } from '../components/PublicShell'
import { AuthProvider, RequireAdmin, RequireAuth } from '../lib/auth'
import { AdminActivity } from '../pages/AdminActivity'
import { AuditTrail } from '../pages/AuditTrail'
import { ChangePassword } from '../pages/ChangePassword'
import { Create } from '../pages/Create'
import { Dashboard } from '../pages/Dashboard'
import { Gone } from '../pages/Gone'
import { Landing } from '../pages/Landing'
import { LinkReady } from '../pages/LinkReady'
import { Login } from '../pages/Login'
import { NotFound } from '../pages/NotFound'
import { RequestCreate } from '../pages/RequestCreate'
import { RequestReady } from '../pages/RequestReady'
import { Requests } from '../pages/Requests'
import { RequestSubmit } from '../pages/RequestSubmit'
import { Reveal } from '../pages/Reveal'

/**
 * The entire staff surface, in one lazily-imported module.
 *
 * App.tsx imports this only inside `if (STAFF)`, where STAFF is a build-time
 * constant. In the public build that branch is statically false, so Rollup drops
 * this file and everything it imports — Create, Dashboard, AuditTrail, Login,
 * AppShell, the auth context — out of the bundle entirely. A client therefore
 * never downloads the internal code, never learns the endpoint paths, and never
 * learns the internal hostname.
 *
 * Staff keep access to the reveal pages so they can test their own links.
 */
export default function StaffRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicShell><Login /></PublicShell>} />
        <Route
          path="/account/password"
          element={<AppShell><RequireAuth><ChangePassword /></RequireAuth></AppShell>}
        />

        {/* The app opens on its primary action, not on marketing. A signed-out
            visitor chains through: / -> /create -> RequireAuth -> /login
            (carrying from:'/create') -> back to /create after signing in. */}
        <Route path="/" element={<Navigate to="/create" replace />} />

        {/* Home lives at /home, reached from the wordmark and the nav.
            Deliberately NOT wrapped in RequireAuth: a signed-out staff member
            should still see the explainer, and the nav links take them to
            /login when they click through. */}
        <Route path="/home" element={<AppShell><Landing /></AppShell>} />

        {(
          [
            ['/create', <Create key="c" />],
            ['/link', <LinkReady key="l" />],
            ['/dashboard', <Dashboard key="d" />],
            ['/dashboard/:tid', <AuditTrail key="a" />],
            // Inbound: asking a client to send US a credential.
            ['/requests', <Requests key="rq" />],
            ['/requests/new', <RequestCreate key="rn" />],
            ['/requests/ready', <RequestReady key="rr" />],
          ] as const
        ).map(([path, el]) => (
          <Route
            key={path}
            path={path}
            element={<AppShell><RequireAuth>{el}</RequireAuth></AppShell>}
          />
        ))}

        {/* Administrators only. The backend enforces this independently. */}
        <Route
          path="/admin/activity"
          element={<AppShell><RequireAdmin><AdminActivity /></RequireAdmin></AppShell>}
        />

        {/* Client-facing pages, unauthenticated even here. */}
        <Route path="/s/:token" element={<PublicShell><Reveal /></PublicShell>} />
        <Route path="/r/:token" element={<PublicShell><RequestSubmit /></PublicShell>} />
        <Route path="/gone" element={<PublicShell><Gone /></PublicShell>} />
        <Route path="*" element={<PublicShell><NotFound /></PublicShell>} />
      </Routes>
    </AuthProvider>
  )
}
