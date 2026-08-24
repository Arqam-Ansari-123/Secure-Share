"""Staff identity: sessions and the single authorization gate.

Replaces the old session.py, which was deleted rather than adapted. Every one of
its functions was part of the problem — `current_sender` MINTED an identity for
anyone who asked, `existing_sender` trusted an unbounded cookie string it had
never issued, and `upsert` wrote a permanent row for every visitor. Keeping the
module would have left `current_sender` one import away from being reused.

Sessions are opaque tokens held in Redis, not signed cookies. Revocation has to
be immediate — logout, `manage.py disable`, password rotation — and a signed
cookie can only manage that with a server-side denylist, which is the same Redis
plus a second mechanism. The Redis key is sha256 of the token, mirroring
`tid = sha256(link_token)` elsewhere, so a Redis dump yields no usable sessions.
"""

import hashlib
import secrets as pysecrets
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response

import config
import store

TOKEN_LEN = 43  # len(secrets.token_urlsafe(32))

# Endpoints a user with must_change_password may still reach.
PASSWORD_EXEMPT = frozenset({"/api/auth/me", "/api/auth/password", "/api/auth/logout"})


@dataclass(frozen=True, slots=True)
class Staff:
    id: str
    email: str
    name: str
    admin: bool
    must_change_password: bool
    # 'local' or 'ad'. Carried in the session so the UI knows whether the
    # change-password form applies, and so the key-migration prompt can explain
    # a domain password change rather than an admin reset.
    auth_source: str = "local"


def _key(token: str) -> str:
    return f"sess:{hashlib.sha256(token.encode()).hexdigest()}"


async def create_session(user: dict, response: Response) -> str:
    token = pysecrets.token_urlsafe(32)
    k = _key(token)
    payload = {
        "uid": str(user["id"]),
        "email": user["email"],
        "name": user["display_name"],
        "admin": "1" if user["is_admin"] else "0",
        "pwc": "1" if user["must_change_password"] else "0",
        "src": user.get("auth_source", "local"),
        "created": str(int(time.time())),
    }
    await store.r.hset(k, mapping=payload)
    await store.r.expire(k, config.SESSION_IDLE_SECONDS)
    # Index so "log out everywhere" does not need a keyspace scan.
    await store.r.sadd(f"usess:{payload['uid']}", k)
    await store.r.expire(f"usess:{payload['uid']}", config.SESSION_ABSOLUTE_SECONDS)

    response.set_cookie(
        config.STAFF_COOKIE,
        token,
        max_age=config.SESSION_ABSOLUTE_SECONDS,
        httponly=True,
        samesite="strict",
        secure=config.IS_PROD,
        path="/",
    )
    return token


async def load_session(request: Request) -> Staff | None:
    token = request.cookies.get(config.STAFF_COOKIE)
    # Bound the value BEFORE it is ever used to build a Redis key. The old code
    # accepted any string of any length as proof of identity.
    if not token or len(token) != TOKEN_LEN:
        return None

    k = _key(token)
    data = await store.r.hgetall(k)
    if not data:
        return None
    d = {
        (kk.decode() if isinstance(kk, bytes) else kk): (vv.decode() if isinstance(vv, bytes) else vv)
        for kk, vv in data.items()
    }

    # Absolute cap: sliding expiry alone means a session that is polled forever
    # never dies.
    if int(time.time()) - int(d.get("created", 0)) > config.SESSION_ABSOLUTE_SECONDS:
        await store.r.delete(k)
        await store.r.srem(f"usess:{d.get('uid', '')}", k)
        return None

    # Slide the idle window, but only when it has actually drifted — avoids an
    # EXPIRE on every single request.
    ttl = await store.r.ttl(k)
    if ttl is not None and ttl < config.SESSION_IDLE_SECONDS - 300:
        await store.r.expire(k, config.SESSION_IDLE_SECONDS)

    return Staff(
        id=d["uid"],
        email=d["email"],
        name=d["name"],
        admin=d.get("admin") == "1",
        must_change_password=d.get("pwc") == "1",
        auth_source=d.get("src", "local"),
    )


async def destroy_session(request: Request, response: Response) -> None:
    token = request.cookies.get(config.STAFF_COOKIE)
    if token and len(token) == TOKEN_LEN:
        k = _key(token)
        uid = await store.r.hget(k, "uid")
        await store.r.delete(k)
        if uid:
            await store.r.srem(f"usess:{uid.decode() if isinstance(uid, bytes) else uid}", k)
    response.delete_cookie(config.STAFF_COOKIE, path="/")


async def destroy_all_sessions(user_id: str) -> None:
    idx = f"usess:{user_id}"
    keys = await store.r.smembers(idx)
    for k in keys:
        await store.r.delete(k.decode() if isinstance(k, bytes) else k)
    await store.r.delete(idx)


async def mark_password_changed(staff: Staff) -> None:
    """Clear the pwc flag on every live session for this user."""
    idx = f"usess:{staff.id}"
    for k in await store.r.smembers(idx):
        await store.r.hset(k.decode() if isinstance(k, bytes) else k, "pwc", "0")


def _csrf_ok(request: Request) -> bool:
    """State-changing requests must prove they came from our own front end.

    SameSite=Strict already covers this in a compliant browser, but SameSite is
    a client-side control. api.ts has always SENT X-Requested-With; nothing ever
    checked it, so until now it provided exactly nothing.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return True
    if request.headers.get("x-requested-with") == "XMLHttpRequest":
        return True
    origin = request.headers.get("origin")
    return bool(origin) and origin == config.FRONTEND_ORIGIN


async def require_staff(request: Request) -> Staff:
    """The single gate. Applied router-level so new routes inherit it."""
    staff = await load_session(request)
    if staff is None:
        raise HTTPException(401, "authentication required")
    if not _csrf_ok(request):
        raise HTTPException(403, "cross-site request blocked")
    if staff.must_change_password and request.url.path not in PASSWORD_EXEMPT:
        raise HTTPException(403, "password_change_required")
    return staff


async def require_admin(request: Request) -> Staff:
    """Everything require_staff enforces, plus the admin flag.

    A thin wrapper on purpose — it reuses the same session lookup, CSRF check
    and password-change gate rather than growing a second, subtly different
    path. `admin` comes from the Redis session, which is written at login from
    users.is_admin, a column the application role cannot write to.
    """
    staff = await require_staff(request)
    if not staff.admin:
        raise HTTPException(403, "administrator access required")
    return staff


async def load_user_by_email(email: str) -> dict | None:
    import db

    return await db.fetchrow(
        """SELECT id, email, display_name, pw_hash, is_active, is_admin,
                  must_change_password, failed_logins, locked_until, auth_source
           FROM users WHERE email = %s""",
        (email,),
    )


def normalise_email(email: str) -> str:
    import unicodedata

    return unicodedata.normalize("NFKC", email).strip().lower()


async def resolve_local_identifier(raw: str) -> str | None:
    """The LOCAL account this identifier refers to, or None.

    Staff may type a full address or just a username:

        arqam@genetechsolutions.com      the full address
        arqam                            just the username

    Local accounts are checked FIRST and win. They are few and operator-created,
    and this is what keeps the break-glass administrator able to sign in while
    the domain controller is unreachable — which is exactly when someone needs a
    tool for sharing credentials.

    Returns None for anything that is not a local account. Those go to Active
    Directory, which does its own resolution against the directory itself —
    appending a domain here would be wrong, because the forest uses five
    different UPN suffixes.
    """
    import db

    ident = normalise_email(raw)
    if not ident:
        return None

    # A full address matches only on the full address. Matching its local part
    # would let `arqam@genetech.co` resolve to the local `arqam@genetechsolutions.com`
    # and shadow a genuine domain account of the same name.
    if "@" in ident:
        row = await db.fetchrow(
            "SELECT email FROM users WHERE auth_source = 'local' AND email = %s", (ident,)
        )
    else:
        row = await db.fetchrow(
            """SELECT email FROM users
               WHERE auth_source = 'local' AND split_part(email, '@', 1) = %s
               ORDER BY email LIMIT 1""",
            (ident,),
        )
    return row["email"] if row else None


def rate_bucket_for(raw: str, local_email: str | None) -> str:
    """One rate-limit bucket per account, whichever spelling was typed.

    Without this, `ahmed` and `ahmed@genetech.co` would get separate counters and
    an attacker could alternate between them for double the attempts. The local
    part is the common denominator: it is what a bare username already is, and
    what an address reduces to. Two people sharing a local part across domains
    would share a bucket, which is stricter than necessary rather than looser.
    """
    return email_bucket(local_email or normalise_email(raw).split("@")[0])


def email_bucket(email: str) -> str:
    """Rate-limit key for an account.

    Hashed, not raw: staff addresses should not be sitting in the Redis keyspace
    where KEYS or MONITOR would dump the company directory.
    """
    return hashlib.sha256(email.encode()).hexdigest()[:32]


__all__ = [
    "Staff",
    "require_staff",
    "require_admin",
    "create_session",
    "load_session",
    "destroy_session",
    "destroy_all_sessions",
    "mark_password_changed",
    "load_user_by_email",
    "normalise_email",
    "email_bucket",
]
