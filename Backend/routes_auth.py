"""Staff authentication.

The ordering inside login() is deliberate and load-bearing — see the comment
above the dummy-hash call.
"""

import asyncio
import base64
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, SecretStr

import audit
import auth
import config
import db
import ldap_auth
import passwords
import security
import store

router = APIRouter(prefix="/api/auth", tags=["auth"])

log = logging.getLogger("secureshare")

GENERIC = "invalid email or password"


class LoginIn(BaseModel):
    email: str
    password: SecretStr


class PasswordIn(BaseModel):
    current: SecretStr
    new: SecretStr


class MeOut(BaseModel):
    email: str
    display_name: str
    is_admin: bool
    must_change_password: bool
    # 'ad' users have no local password: the change-password form does not
    # apply to them, and their key migration flow differs.
    auth_source: str = "local"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _login_ad(typed: str, password: str, request: Request, response: Response,
                    started: float) -> MeOut:
    """Domain sign-in. Every failure exits through the same constant-time floor.

    `typed` is the raw identifier — a username, a UPN or a mail address.
    ldap_auth resolves it against the directory and then binds AS that person;
    nothing here assumes a domain, because the forest has five UPN suffixes.

    A single generic 401 covers all of: no such account, not a member of the
    required group, disabled, and wrong password. That is deliberate — the group
    gate is applied inside the directory search, so a non-member never reaches a
    bind and cannot be distinguished from a typo.

    `started` is the caller's clock, not one taken here, so that an AD failure
    and a local failure take the SAME total time. Since a bare username is
    routed to whichever backend owns it, a difference between the two would
    reveal which accounts are local — see the note in login().

    Note there is no local lockout counter here: Active Directory owns
    `badPwdCount` and its own lockout policy. Running a second counter would lock
    people out of SecureShare while the domain is perfectly happy — and, worse,
    our retries feed AD's counter. The per-email rate limit above is what stops
    this app locking someone out of the domain, which makes it load-bearing
    rather than merely defensive.
    """
    identity = await ldap_auth.authenticate(typed, password)

    if identity is None:
        await ldap_auth.constant_floor(started)
        await audit.record(None, audit.LOGIN_FAIL, request=request, ok=False,
                           reason="ad_bind_failed")
        raise HTTPException(401, GENERIC)

    user = await auth.load_user_by_email(identity.email)

    if user is None:
        # First sign-in. The application cannot INSERT into `users`; this calls a
        # narrow SECURITY DEFINER function that can only ever create an ordinary
        # non-admin AD account. See sql/007_ad_auth.sql.
        try:
            await db.execute(
                "SELECT provision_ad_user(%s, %s, %s, %s)",
                (identity.email, identity.display_name, identity.upn, identity.guid),
            )
        except Exception:
            log.exception("AD provisioning failed for %s", identity.email)
            await ldap_auth.constant_floor(started)
            raise HTTPException(403, "your account could not be set up — contact IT")
        user = await auth.load_user_by_email(identity.email)
        await audit.record(None, audit.ACCOUNT_CREATED, request=request,
                           reason="ad_provisioned", subject=identity.email)

    if user is None or not user["is_active"]:
        await ldap_auth.constant_floor(started)
        await audit.record(None, audit.LOGIN_FAIL, request=request, ok=False, reason="inactive")
        raise HTTPException(401, GENERIC)

    # Keep the directory's view of the name current, and record the sign-in.
    await db.execute(
        """UPDATE users SET last_login_at=now(), display_name=%s, ad_upn=%s, ad_guid=%s
           WHERE id=%s""",
        (identity.display_name, identity.upn, identity.guid, user["id"]),
    )

    await auth.create_session(user, response)
    staff = auth.Staff(str(user["id"]), user["email"], identity.display_name,
                       user["is_admin"], False, "ad")
    await audit.record(None, audit.LOGIN_OK, request=request, actor=staff, reason="ad")

    return MeOut(
        email=user["email"],
        display_name=identity.display_name,
        is_admin=user["is_admin"],
        must_change_password=False,   # AD owns the password; never force a local rotation
        auth_source="ad",
    )


@router.post("/login", response_model=MeOut)
async def login(body: LoginIn, request: Request, response: Response):
    # One clock for the whole handler. Both the AD and the local path pad every
    # failure out to the same floor before answering — see the note below.
    started = time.perf_counter()

    ip = security.client_ip(request) or "?"
    if not await store.rate_ok("login_ip", ip):
        raise HTTPException(429, "too many attempts", headers={"Retry-After": "300"})

    # Which backend owns this identifier? Local accounts win, so the break-glass
    # administrator can sign in while the DC is unreachable. Everything else goes
    # to AD, which resolves the identifier against the directory itself — the
    # forest has five UPN suffixes, so there is no domain to append here.
    typed = auth.normalise_email(body.email)
    local_email = await auth.resolve_local_identifier(typed)

    # Bucket before either path, and on the account rather than the spelling.
    if not await store.rate_ok("login_email", auth.rate_bucket_for(typed, local_email)):
        raise HTTPException(429, "too many attempts", headers={"Retry-After": "900"})

    # Both paths must be indistinguishable from outside. An unpadded local path
    # (~92 ms of scrypt) against an unpadded AD path (a directory search plus a
    # bind) would answer "is there a local account named X?" by stopwatch. Every
    # 401 below therefore exits through constant_floor(started).

    # --- Active Directory ---------------------------------------------------
    if local_email is None or not config.LOCAL_LOGIN_ENABLED:
        if config.AD_ENABLED:
            return await _login_ad(typed, body.password.get_secret_value(), request, response, started)

        # Nothing can authenticate this. Still burn the constant time, so a
        # disabled backend is not itself an oracle.
        await asyncio.to_thread(
            passwords.verify_password, body.password.get_secret_value(), passwords.DUMMY_HASH
        )
        await ldap_auth.constant_floor(started)
        await audit.record(None, audit.LOGIN_FAIL, request=request, ok=False,
                           reason="unknown_user")
        raise HTTPException(401, GENERIC)

    email = local_email

    user = await auth.load_user_by_email(email)
    locked = bool(user and user["locked_until"] and user["locked_until"] > _now())

    # Unknown, inactive and locked accounts must cost the SAME ~92 ms and return
    # the SAME body as a wrong password. Skipping the hash here would let a 2 ms
    # response enumerate the company's staff list.
    if user is None or not user["is_active"] or locked or user["auth_source"] != "local":
        await asyncio.to_thread(
            passwords.verify_password, body.password.get_secret_value(), passwords.DUMMY_HASH
        )
        await audit.record(
            None, audit.LOGIN_FAIL, request=request, ok=False,
            reason="unknown_user" if user is None else ("inactive" if not user["is_active"] else "locked"),
        )
        await ldap_auth.constant_floor(started)
        raise HTTPException(401, GENERIC)

    ok, needs_rehash = await asyncio.to_thread(
        passwords.verify_password, body.password.get_secret_value(), user["pw_hash"]
    )

    if not ok:
        fails = user["failed_logins"] + 1
        lock_for = None
        if fails % config.LOCKOUT_THRESHOLD == 0:
            steps = fails // config.LOCKOUT_THRESHOLD
            secs = min(config.LOCKOUT_SECONDS * (2 ** (steps - 1)), config.LOCKOUT_MAX_SECONDS)
            lock_for = _now() + timedelta(seconds=secs)
        await db.execute(
            "UPDATE users SET failed_logins=%s, locked_until=COALESCE(%s, locked_until) WHERE id=%s",
            (fails, lock_for, user["id"]),
        )
        # Never echo the submitted address into an append-only table we cannot clean.
        await audit.record(None, audit.LOGIN_FAIL, request=request, ok=False, reason="bad_password")
        await ldap_auth.constant_floor(started)
        raise HTTPException(401, GENERIC)

    if needs_rehash:
        await db.execute(
            "UPDATE users SET pw_hash=%s WHERE id=%s",
            (await asyncio.to_thread(passwords.hash_password, body.password.get_secret_value()),
             user["id"]),
        )

    await db.execute(
        "UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=%s",
        (user["id"],),
    )
    await auth.create_session(user, response)
    staff = auth.Staff(str(user["id"]), user["email"], user["display_name"],
                       user["is_admin"], user["must_change_password"])
    await audit.record(None, audit.LOGIN_OK, request=request, actor=staff)

    return MeOut(
        email=user["email"],
        display_name=user["display_name"],
        is_admin=user["is_admin"],
        must_change_password=user["must_change_password"],
    )


# NOTE on the `response: Response` parameter in the handlers below: returning a
# NEW Response object (e.g. `return Response(status_code=204)`) discards every
# header set on the injected one — including Set-Cookie. Return None and let
# FastAPI merge the injected response's headers, or the cookie silently never
# reaches the browser.

@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response):
    """Deliberately ungated and idempotent — logging out must always succeed."""
    staff = await auth.load_session(request)
    await auth.destroy_session(request, response)
    if staff:
        await audit.record(None, audit.LOGOUT, request=request, actor=staff)


@router.post("/logout-all", status_code=204)
async def logout_all(request: Request, response: Response,
                     staff: auth.Staff = Depends(auth.require_staff)):
    await auth.destroy_all_sessions(staff.id)
    response.delete_cookie(config.STAFF_COOKIE, path="/")
    await audit.record(None, audit.LOGOUT, request=request, actor=staff, reason="all_devices")


@router.get("/me", response_model=MeOut)
async def me(staff: auth.Staff = Depends(auth.require_staff)):
    return MeOut(
        email=staff.email,
        display_name=staff.name,
        is_admin=staff.admin,
        must_change_password=staff.must_change_password,
        auth_source=staff.auth_source,
    )


# --- the employee's encryption keypair --------------------------------------
# Clients encrypt credential submissions to the employee's PUBLIC key. The
# private half is stored here WRAPPED: encrypted in the browser under a key
# derived from the employee's password, which never reaches this server. So
# these columns hold a blob the server has no way to unwrap — which is what
# keeps inbound submissions zero-knowledge, exactly like outbound secrets.

class KeysIn(BaseModel):
    pubkey: str            # base64
    privkey_wrapped: str   # base64, AES-GCM under PBKDF2(password)
    privkey_salt: str      # base64
    privkey_iters: int


class KeysOut(BaseModel):
    pubkey: str | None = None
    privkey_wrapped: str | None = None
    privkey_salt: str | None = None
    privkey_iters: int | None = None


@router.get("/keys", response_model=KeysOut)
async def get_keys(staff: auth.Staff = Depends(auth.require_staff)):
    row = await db.fetchrow(
        "SELECT pubkey, privkey_wrapped, privkey_salt, privkey_iters FROM users WHERE id=%s",
        (staff.id,),
    )
    if not row or not row["pubkey"]:
        return KeysOut()
    return KeysOut(
        pubkey=base64.b64encode(row["pubkey"]).decode(),
        privkey_wrapped=base64.b64encode(row["privkey_wrapped"]).decode(),
        privkey_salt=base64.b64encode(row["privkey_salt"]).decode(),
        privkey_iters=row["privkey_iters"],
    )


@router.put("/keys", status_code=204)
async def put_keys(body: KeysIn, request: Request,
                   staff: auth.Staff = Depends(auth.require_staff)):
    """Publish a keypair, or re-wrap it after a password change.

    Deliberately an unconditional overwrite. Rotating the wrapping key on a
    password change means writing the same private key under new wrapping, and
    the caller is the only party who can produce a valid blob anyway.
    """
    await db.execute(
        """UPDATE users SET pubkey=%s, privkey_wrapped=%s, privkey_salt=%s, privkey_iters=%s
           WHERE id=%s""",
        (
            base64.b64decode(body.pubkey),
            base64.b64decode(body.privkey_wrapped),
            base64.b64decode(body.privkey_salt),
            body.privkey_iters,
            staff.id,
        ),
    )


@router.post("/password", status_code=204)
async def change_password(body: PasswordIn, request: Request, response: Response,
                          staff: auth.Staff = Depends(auth.require_staff)):
    if not await store.rate_ok("pwchange", staff.id):
        raise HTTPException(429, "too many attempts")

    row = await db.fetchrow(
        "SELECT pw_hash, email, auth_source FROM users WHERE id=%s", (staff.id,)
    )
    if row and row["auth_source"] == "ad":
        # Their password lives in Active Directory. Changing it here would be
        # meaningless, and there is no local hash to verify against anyway.
        raise HTTPException(
            400,
            "your password is managed by Active Directory — change it on your computer "
            "(Ctrl+Alt+Delete) or through your IT helpdesk",
        )
    ok, _ = await asyncio.to_thread(
        passwords.verify_password, body.current.get_secret_value(), row["pw_hash"]
    )
    if not ok:
        raise HTTPException(401, "current password is incorrect")

    new = body.new.get_secret_value()
    problem = passwords.check_policy(new, row["email"])
    if problem:
        raise HTTPException(400, problem)

    await db.execute(
        """UPDATE users SET pw_hash=%s, must_change_password=false, pw_changed_at=now()
           WHERE id=%s""",
        (await asyncio.to_thread(passwords.hash_password, new), staff.id),
    )

    # Kill every other session, then re-issue one for the tab doing the change —
    # otherwise changing your password logs you out of the page you are on.
    await auth.destroy_all_sessions(staff.id)
    user = await db.fetchrow(
        """SELECT id, email, display_name, is_admin, must_change_password
           FROM users WHERE id=%s""",
        (staff.id,),
    )
    await auth.create_session(user, response)
    await audit.record(None, audit.PASSWORD_CHANGED, request=request, actor=staff)
