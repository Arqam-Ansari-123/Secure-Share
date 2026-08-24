"""Credential requests — the inbound direction.

An employee issues a request link; a client opens it and submits a credential
encrypted to that employee's public key. Two routers, deliberately separate:

  staff_router   POST/GET /api/requests, revoke      — require_staff
  public_router  GET/POST /api/r/{token}...          — no auth, by design

The split mirrors routes_sender.py vs routes_secrets.py: placement carries the
security property, so a route cannot drift onto the wrong side of the boundary
by someone adding it to the wrong file.

Why a client may create a secret here but not at /create: the request token IS
the authorization. It was issued by a named employee, it is scoped to one
request, it expires, and it can be revoked. /create stays closed to outsiders.
"""

import base64
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile

import audit
import auth
import config
import db
import notify
import schemas
import security
import store

staff_router = APIRouter(prefix="/api", tags=["requests"], dependencies=[Depends(auth.require_staff)])
public_router = APIRouter(prefix="/api", tags=["requests-public"])

CHUNK = 64 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _limit(scope: str, key: str | None) -> None:
    if key and not await store.rate_ok(scope, key):
        raise HTTPException(429, "too many requests", headers={"Retry-After": "60"})


async def _read_capped(upload: UploadFile) -> bytes:
    """Streaming running total — Content-Length is attacker-controlled."""
    out, total = bytearray(), 0
    while chunk := await upload.read(CHUNK):
        total += len(chunk)
        if total > config.MAX_BLOB_BYTES:
            raise HTTPException(413, "secret too large")
        out.extend(chunk)
    if not total:
        raise HTTPException(400, "empty payload")
    return bytes(out)


# ============================================================== staff side ===

@staff_router.post("/requests", status_code=201, response_model=schemas.RequestOut)
async def create_request(
    body: schemas.RequestCreate,
    request: Request,
    staff: auth.Staff = Depends(auth.require_staff),
):
    await _limit("create", security.client_ip(request))

    # The employee must have published a public key before anyone can encrypt
    # to them. The frontend sets one up at first sign-in.
    row = await db.fetchrow("SELECT pubkey FROM users WHERE id=%s", (staff.id,))
    if not row or not row["pubkey"]:
        raise HTTPException(
            409,
            "no encryption key set up for this account — reload the app to generate one",
        )

    ttl = max(3600, min(body.expires_in or config.REQUEST_TTL_SECONDS, config.MAX_TTL_SECONDS))
    token = security.new_token()
    rid = security.tid_of(token)
    expires_at = _now() + timedelta(seconds=ttl)

    # Pin the key this request is issued against. users.pubkey can be rotated
    # later (an admin password reset does exactly that), and a reply already in
    # flight would then be encrypted to a key the employee no longer holds.
    # Snapshotting it here is what makes that mismatch detectable instead of
    # silently destroying an unreadable credential.
    await db.execute(
        """INSERT INTO secret_requests (rid, user_id, label, client_hint, expires_at, pubkey)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (rid, staff.id, body.label, body.client_hint, expires_at, row["pubkey"]),
    )
    await audit.record(None, audit.REQUEST_CREATED, request=request, actor=staff, target=rid[:16])

    return schemas.RequestOut(
        token=token,
        rid=rid,
        url=f"{config.PUBLIC_BASE_URL}/r/{token}",
        expires_at=expires_at,
    )


@staff_router.get("/requests", response_model=list[schemas.RequestRow])
async def list_requests(staff: auth.Staff = Depends(auth.require_staff)):
    # reply_status comes from the reply secret itself, which is the only real
    # record of whether it has been read: retrieval is a GETDEL, so a second
    # attempt would 410. Deriving it here means the UI still knows after a page
    # reload, when component state is gone.
    #
    # LEFT JOIN because fulfilled_tid is NULL until a client answers.
    return await db.fetch(
        """SELECT r.rid, r.label, r.client_hint, r.created_at, r.expires_at,
                  r.status, r.status_at, r.fulfilled_tid, u.email AS requested_by,
                  sec.status AS reply_status, sec.status_at AS reply_read_at,
                  encode(r.pubkey, 'base64') AS request_pubkey
           FROM secret_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN secrets sec ON sec.tid = r.fulfilled_tid
           WHERE (r.user_id = %s OR %s) ORDER BY r.created_at DESC LIMIT 200""",
        (staff.id, staff.admin),
    )


@staff_router.post("/requests/{rid}/revoke", status_code=204)
async def revoke_request(rid: str, request: Request,
                         staff: auth.Staff = Depends(auth.require_staff)):
    row = await db.fetchrow(
        "SELECT status FROM secret_requests WHERE rid=%s AND (user_id=%s OR %s)",
        (rid, staff.id, staff.admin),
    )
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "open":
        raise HTTPException(409, f"already {row['status']}")

    await db.execute(
        "UPDATE secret_requests SET status='revoked', status_at=now() WHERE rid=%s", (rid,)
    )
    await audit.record(None, audit.REQUEST_REVOKED, request=request, actor=staff, target=rid[:16])


# ============================================================= public side ===

async def _load_open_request(token: str) -> dict:
    """Resolve a request token, or raise the right status.

    404 vs 410 distinguishes "never existed" from "gone" — the token is 256 bits
    so enumeration is infeasible and the distinction leaks nothing, while the
    client-facing page needs to say something accurate.
    """
    rid = security.tid_of(token)
    row = await db.fetchrow("SELECT * FROM secret_requests WHERE rid=%s", (rid,))
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "open":
        raise HTTPException(410, row["status"])
    if row["expires_at"] <= _now():
        await db.execute(
            "UPDATE secret_requests SET status='expired', status_at=now() "
            "WHERE rid=%s AND status='open'",
            (rid,),
        )
        raise HTTPException(410, "expired")
    return row


@public_router.get("/r/{token}", response_model=schemas.RequestPublic)
async def view_request(token: str, request: Request):
    """What the client's page needs: who is asking, and the key to encrypt to.

    Non-destructive, like /meta — a link preview cannot consume a request.
    """
    await _limit("request_view", security.client_ip(request))
    row = await _load_open_request(token)

    user = await db.fetchrow(
        "SELECT email, display_name, pubkey FROM users WHERE id=%s", (row["user_id"],)
    )
    # The key pinned to the request wins over the employee's current one: if it
    # has been rotated since, encrypting to the new key would produce a reply the
    # request's own records say is unreadable. Fall back only for rows created
    # before 006.
    pubkey = row["pubkey"] or (user or {}).get("pubkey")
    if not user or not pubkey:
        raise HTTPException(410, "the requester's key is unavailable")

    await audit.record(None, audit.REQUEST_VIEWED, request=request, target=row["rid"][:16])

    return schemas.RequestPublic(
        label=row["label"],
        requested_by=user["display_name"],
        requested_by_email=user["email"],
        pubkey=base64.b64encode(pubkey).decode(),
        expires_at=row["expires_at"],
    )


@public_router.post("/r/{token}/submit", status_code=201)
async def submit_request(
    token: str,
    request: Request,
    bg: BackgroundTasks,
    blob: UploadFile = File(...),
    staff_note: str = Form(default=""),
):
    """The client submits. Creates an ordinary secret owned by the requester.

    Reusing the secrets table means the employee's dashboard, revoke and audit
    pages all work on it with no special cases — and the one-time GETDEL
    guarantee applies exactly as it does to outbound secrets.
    """
    ip = security.client_ip(request)
    await _limit("request_submit_ip", ip)

    row = await _load_open_request(token)
    rid = row["rid"]
    # Per-request limit: IP limits alone don't help when IPs rotate.
    await _limit("request_submit_rid", rid)

    payload = await _read_capped(blob)

    # The reply is itself a one-time secret, inheriting the request's deadline so
    # a submitted credential never outlives the request that asked for it.
    #
    # No link token is minted: there is nobody to give it to. The requesting
    # employee retrieves this through the authenticated endpoint below, which is
    # also what keeps the reply readable only by its owner. The tid is derived
    # from the request id so it is deterministic and needs no storage.
    ttl = max(60, int((row["expires_at"] - _now()).total_seconds()))
    tid = security.tid_of(f"reply:{rid}")

    await store.put_blob(tid, payload, ttl)
    await db.execute(
        """INSERT INTO secrets (tid, user_id, expires_at, has_passphrase,
                                max_attempts, size_bytes, label)
           VALUES (%s,%s,%s,false,5,%s,%s)""",
        (
            tid,
            row["user_id"],
            row["expires_at"],
            len(payload),
            f"Reply: {row['label'] or 'credential request'}",
        ),
    )
    await db.execute(
        "UPDATE secret_requests SET status='fulfilled', status_at=now(), fulfilled_tid=%s "
        "WHERE rid=%s AND status='open'",
        (tid, rid),
    )
    await audit.record(tid, audit.REQUEST_FULFILLED, request=request, target=rid[:16],
                       size_bytes=len(payload))

    # The employee needs to know something arrived; they hold the only key.
    user = await db.fetchrow("SELECT email FROM users WHERE id=%s", (row["user_id"],)) or {}
    bg.add_task(notify.request_fulfilled, rid, row["label"], user.get("email"), ip)

    return {"ok": True}


@staff_router.post("/requests/{rid}/reply", response_model=schemas.RevealOut)
async def take_reply(rid: str, request: Request,
                     staff: auth.Staff = Depends(auth.require_staff)):
    """Retrieve the client's submission — once.

    Same one-time guarantee as any other secret: a single GETDEL, and the
    ciphertext is gone. Only the requesting employee can decrypt it anyway,
    since it was encrypted to their public key.
    """
    row = await db.fetchrow(
        """SELECT status, fulfilled_tid FROM secret_requests
           WHERE rid=%s AND (user_id=%s OR %s)""",
        (rid, staff.id, staff.admin),
    )
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "fulfilled" or not row["fulfilled_tid"]:
        raise HTTPException(409, "no reply yet")

    tid = row["fulfilled_tid"]
    payload = await store.take_blob(tid)  # the same single GETDEL used everywhere
    if payload is None:
        raise HTTPException(410, "already retrieved or expired")

    await db.execute(
        "UPDATE secrets SET status='viewed', status_at=now(), status_reason='viewed' "
        "WHERE tid=%s AND status='active'",
        (tid,),
    )
    await audit.record(tid, audit.REVEAL_OK, request=request, actor=staff, size_bytes=len(payload))

    return schemas.RevealOut(blob=base64.b64encode(payload).decode(), size_bytes=len(payload))
