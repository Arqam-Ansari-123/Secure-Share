"""Negative tests for the staff/client boundary.

These are the tests that matter. The positive path ("a logged-in user can create
a secret") failing is obvious in five seconds of manual use; the boundary failing
is silent and is exactly how Phase 1 shipped an endpoint that let anyone on the
internet create secrets on the company domain.

    python verify_boundary.py [--base http://127.0.0.1:8000] --email you@â€¦ --password â€¦

Uses httpx (already a dependency) and subprocess for the psql checks. No pytest â€”
that would be a new dependency, and it matches how the crypto contract tests run.
"""

import argparse
import subprocess
import sys
import time

import httpx

import config

PASS, FAIL = 0, 0


def check(name: str, ok: bool, extra: str = "") -> None:
    global PASS, FAIL
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{f'  â€” {extra}' if extra else ''}")
    if ok:
        PASS += 1
    else:
        FAIL += 1


def reset_auth_limits() -> None:
    """Clear the login and password-change rate-limit buckets.

    The suite deliberately burns attempts to prove the enumeration defence and
    the password policy, which would otherwise 429 the legitimate calls that
    follow. Scoped to the auth buckets so the reveal and create limiters â€” which
    other tests depend on â€” are left untouched.
    """
    for pattern in ("rl:login_*", "rl:pwchange*"):
        cmd = (
            'cd "/mnt/f/Arqam/link sharing app" && docker compose exec -T redis sh -c '
            f"\"redis-cli --scan --pattern '{pattern}' | xargs -r redis-cli del\" >/dev/null 2>&1"
        )
        subprocess.run(["wsl", "-u", "root", "-e", "bash", "-c", cmd], capture_output=True)


def psql(role: str, sql: str) -> str:
    """Run SQL through the compose postgres container; return combined output."""
    env = "-e PGPASSWORD=app_rw_dev_password " if role == "app_rw" else ""
    host = "-h localhost " if role == "app_rw" else ""
    cmd = (
        f'cd "/mnt/f/Arqam/link sharing app" && docker compose exec -T {env}postgres '
        f'psql -U {role} {host}-d secretshare -c "{sql}"'
    )
    r = subprocess.run(["wsl", "-u", "root", "-e", "bash", "-c", cmd],
                       capture_output=True, text=True)
    return (r.stdout or "") + (r.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True, help="current (possibly temporary) password")
    ap.add_argument("--new-password", dest="new_password", default="boundary-Test-Pass-2026",
                    help="used if the account still has must_change_password set")
    ap.add_argument("--staff-email", dest="staff_email", default=None,
                    help="a NON-admin account, to prove the admin log is role-gated")
    ap.add_argument("--staff-password", dest="staff_password", default=None)
    ap.add_argument("--staff-new-password", dest="staff_new_password",
                    default="staff-Boundary-Test-2026",
                    help="used if the non-admin account still has must_change_password set")
    a = ap.parse_args()
    B = a.base.rstrip("/") + "/api"

    print("\n=== N1  unauthenticated create must be refused (the Phase 1 hole) ===")
    with httpx.Client(timeout=20) as c:
        r = c.post(f"{B}/secrets", files={"blob": ("b.bin", b"x")}, data={"meta": "{}"})
        check("POST /api/secrets without a session -> 401", r.status_code == 401,
              f"got {r.status_code}")
        check("...and sets no cookie", "set-cookie" not in r.headers,
              str(dict(r.headers.items())).replace("\n", "")[:80] if "set-cookie" in r.headers else "")

    print("\n=== N2  a client opening a reveal link gets no session ===")
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{B}/s/nonexistenttoken0000000000000000000000000/meta")
        check("GET /meta issues no Set-Cookie", "set-cookie" not in r.headers)
        check("unknown token -> 404 (not 'expired')", r.status_code == 404, f"got {r.status_code}")

    print("\n=== N3  the anonymous-session endpoints are gone ===")
    with httpx.Client(timeout=20) as c:
        for path, body in (("/session", None), ("/session/adopt", {"sender_id": "a" * 24})):
            r = c.post(f"{B}{path}", json=body)
            check(f"POST /api{path} -> 404", r.status_code == 404, f"got {r.status_code}")

    print("\n=== N4  a forged or oversized cookie is not a credential ===")
    for label, val in (("forged", "notarealsession"), ("oversized", "A" * 5000)):
        with httpx.Client(timeout=20, cookies={"ss_staff": val}) as c:
            r = c.get(f"{B}/secrets")
            check(f"{label} cookie -> 401, never 500", r.status_code == 401, f"got {r.status_code}")

    print("\n=== N5  login: enumeration and lockout ===")
    reset_auth_limits()
    with httpx.Client(timeout=30) as c:
        t0 = time.perf_counter()
        r1 = c.post(f"{B}/auth/login", json={"email": "nobody@genetechsolutions.com",
                                             "password": "wrongwrongwrong"})
        t_unknown = time.perf_counter() - t0
        t0 = time.perf_counter()
        r2 = c.post(f"{B}/auth/login", json={"email": a.email, "password": "wrongwrongwrong"})
        t_known = time.perf_counter() - t0
        check("unknown and known accounts return the same status", r1.status_code == r2.status_code == 401)
        check("...and the same body", r1.text == r2.text, f"{r1.text[:40]} vs {r2.text[:40]}")
        # The dummy hash exists so a miss costs the same ~92 ms as a real verify.
        ratio = max(t_unknown, t_known) / max(min(t_unknown, t_known), 1e-6)
        check("...and comparable timing (no user-enumeration oracle)", ratio < 3.0,
              f"unknown {t_unknown*1000:.0f}ms vs known {t_known*1000:.0f}ms")

    print("\n=== N6  authenticated flow works, and is scoped ===")
    reset_auth_limits()  # N5 just consumed the attempt budget on purpose
    with httpx.Client(timeout=30) as c:
        r = c.post(f"{B}/auth/login", json={"email": a.email, "password": a.password})
        if r.status_code != 200:
            check("login with the real password", False, f"got {r.status_code}: {r.text[:120]}")
            print("\n  (cannot continue authenticated checks)\n")
        else:
            check("login with the real password -> 200", True)
            check("session cookie issued", any(k == "ss_staff" for k in c.cookies.keys()))
            me = c.get(f"{B}/auth/me")
            check("GET /auth/me -> 200", me.status_code == 200, me.text[:80])

            # A freshly provisioned account must rotate its operator-issued
            # password before it can do anything. Prove the gate blocks first,
            # then clear it.
            if me.status_code == 200 and me.json().get("must_change_password"):
                blocked = c.post(f"{B}/secrets", files={"blob": ("b.bin", b"x")},
                                 data={"meta": "{}"},
                                 headers={"X-Requested-With": "XMLHttpRequest"})
                check("must_change_password blocks other endpoints -> 403",
                      blocked.status_code == 403
                      and "password_change_required" in blocked.text,
                      f"got {blocked.status_code}")

                weak = c.post(f"{B}/auth/password",
                              json={"current": a.password, "new": "short"},
                              headers={"X-Requested-With": "XMLHttpRequest"})
                check("weak new password rejected -> 400", weak.status_code == 400, weak.text[:60])

                wrong = c.post(f"{B}/auth/password",
                               json={"current": "not-the-password", "new": a.new_password},
                               headers={"X-Requested-With": "XMLHttpRequest"})
                check("wrong current password rejected -> 401", wrong.status_code == 401)

                ch = c.post(f"{B}/auth/password",
                            json={"current": a.password, "new": a.new_password},
                            headers={"X-Requested-With": "XMLHttpRequest"})
                check("password change -> 204", ch.status_code == 204, ch.text[:80])
                check("session survives the change (not logged out of this tab)",
                      c.get(f"{B}/auth/me").status_code == 200)
                check("must_change_password cleared",
                      c.get(f"{B}/auth/me").json().get("must_change_password") is False)

            r = c.post(f"{B}/secrets",
                       files={"blob": ("b.bin", b"BOUNDARYTEST")},
                       data={"meta": '{"expiry_preset":"24h","has_passphrase":false,'
                                     '"max_attempts":5,"label":"boundary test"}'},
                       headers={"X-Requested-With": "XMLHttpRequest"})
            check("authenticated create -> 201", r.status_code == 201, r.text[:120])
            tid = r.json()["tid"] if r.status_code == 201 else None

            if tid:
                rows = c.get(f"{B}/secrets").json()
                check("secret appears on the dashboard", any(x["tid"] == tid for x in rows))
                trail = c.get(f"{B}/secrets/{tid}/audit").json()
                created = [x for x in trail if x["event"] == "created"]
                check("audit 'created' row names the real person",
                      bool(created) and created[0].get("actor_email") == a.email,
                      created[0].get("actor_email") if created else "no row")

            print("\n=== N7  CSRF: real session, foreign Origin, no X-Requested-With ===")
            r = c.post(f"{B}/secrets", files={"blob": ("b.bin", b"x")}, data={"meta": "{}"},
                       headers={"Origin": "https://evil.example"})
            check("cross-origin state change -> 403", r.status_code == 403, f"got {r.status_code}")

            print("\n=== N8  logout invalidates immediately ===")
            c.post(f"{B}/auth/logout", headers={"X-Requested-With": "XMLHttpRequest"})
            r = c.get(f"{B}/secrets")
            check("after logout, staff API -> 401", r.status_code == 401, f"got {r.status_code}")

    print("\n=== N11  the admin surface is admin-only ===")
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{B}/admin/activity")
        check("no session -> 401", r.status_code == 401, f"got {r.status_code}")

    if a.staff_email and a.staff_password:
        reset_auth_limits()
        with httpx.Client(timeout=30) as c:
            lr = c.post(f"{B}/auth/login", json={"email": a.staff_email, "password": a.staff_password})
            if lr.status_code == 200:
                # A freshly provisioned account 403s on EVERYTHING until it
                # rotates the operator-issued password, which would mask the
                # role check below. Clear that first so the 403 we assert is
                # unambiguously about being non-admin.
                if lr.json().get("must_change_password"):
                    c.post(
                        f"{B}/auth/password",
                        json={"current": a.staff_password, "new": a.staff_new_password},
                        headers={"X-Requested-With": "XMLHttpRequest"},
                    )
                r = c.get(f"{B}/admin/activity")
                # A non-admin employee holds a perfectly valid session. This is
                # the check that proves the admin log is gated on the role and
                # not merely on being signed in.
                check("valid NON-ADMIN session -> 403", r.status_code == 403, f"got {r.status_code}")
                r = c.get(f"{B}/secrets")
                check("...but the ordinary staff API still works for them",
                      r.status_code == 200, f"got {r.status_code}")
            else:
                check("non-admin login (needs --staff-password after first rotation)",
                      False, f"got {lr.status_code}")
    else:
        print("  SKIP  non-admin checks (pass --staff-email/--staff-password)")

    print("\n=== N12  inbound credential requests ===")
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{B}/r/{'z' * 43}")
        check("unknown request token -> 404", r.status_code == 404, f"got {r.status_code}")
        r = c.post(f"{B}/r/{'z' * 43}/submit", files={"blob": ("b.bin", b"x")})
        check("submitting to an unknown request -> 404", r.status_code == 404, f"got {r.status_code}")
        # Creating a request is a staff action; an outsider must not be able to
        # mint one and then answer their own.
        r = c.post(f"{B}/requests", json={"label": "x"})
        check("unauthenticated POST /requests -> 401", r.status_code == 401, f"got {r.status_code}")
        r = c.get(f"{B}/requests")
        check("unauthenticated GET /requests -> 401", r.status_code == 401, f"got {r.status_code}")

    print("\n=== N13  Active Directory: the group gate and the service account ===")
    if not config.AD_ENABLED:
        print("  SKIP  AD is disabled")
    elif not config.AD_BIND_PASSWORD:
        print("  SKIP  no AD_BIND_PASSWORD configured")
    else:
        with httpx.Client(timeout=45) as c:
            # The service account's password is CORRECT. It must still be refused,
            # because it is not a member of AD_REQUIRED_GROUP. If this ever passes,
            # a directory credential has become a SecureShare login.
            reset_auth_limits()
            t0 = time.perf_counter()
            r_svc = c.post(f"{B}/auth/login",
                           json={"email": config.AD_BIND_USER, "password": config.AD_BIND_PASSWORD})
            t_svc = time.perf_counter() - t0
            check("service account with its REAL password -> 401",
                  r_svc.status_code == 401, f"got {r_svc.status_code}")

            reset_auth_limits()
            t0 = time.perf_counter()
            r_unk = c.post(f"{B}/auth/login",
                           json={"email": "nosuchperson", "password": "wrongwrongwrong"})
            t_unk = time.perf_counter() - t0
            check("unknown identifier -> 401", r_unk.status_code == 401, f"got {r_unk.status_code}")

            # "Not a member" and "no such account" must be indistinguishable. The
            # gate lives inside the directory search precisely so that neither the
            # body nor the clock can tell them apart.
            check("...with an identical body to an unknown account",
                  r_svc.text == r_unk.text, f"{r_svc.text[:40]} vs {r_unk.text[:40]}")
            ratio = max(t_svc, t_unk) / max(min(t_svc, t_unk), 1e-6)
            check("...and comparable timing (group membership is not observable)",
                  ratio < 3.0, f"non-member {t_svc*1000:.0f}ms vs unknown {t_unk*1000:.0f}ms")

            reset_auth_limits()
            r_local = c.post(f"{B}/auth/login", json={"email": a.email, "password": "wrongwrongwrong"})
            check("a wrong LOCAL password returns the same body as both",
                  r_local.text == r_unk.text, f"{r_local.text[:40]} vs {r_unk.text[:40]}")
        reset_auth_limits()

    print("\n=== N9  layer 2: the app role cannot create identities ===")
    out = psql("app_rw", "insert into users(email,display_name,pw_hash) "
                         "values('evil@genetechsolutions.com','e','scrypt\\$1\\$1\\$1\\$YQ==\\$Yg==')")
    check("app_rw INSERT users -> permission denied", "permission denied" in out, out.strip()[:70])
    out = psql("app_rw", "insert into senders(sender_id) values('anon')")
    check("app_rw INSERT senders -> permission denied", "permission denied" in out, out.strip()[:70])
    out = psql("app_rw", "update users set is_admin=true")
    check("app_rw cannot self-promote to admin", "permission denied" in out, out.strip()[:70])

    print("\n=== N10  the audit trail is still append-only after the migration ===")
    out = psql("appuser", "delete from audit.events where id=1")
    check("owner DELETE blocked by trigger", "append-only" in out, out.strip()[:70])
    out = psql("app_rw", "update audit.events set actor_email='x'")
    check("app_rw UPDATE blocked by grant", "permission denied" in out, out.strip()[:70])

    print(f"\n{PASS} passed, {FAIL} failed\n")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

