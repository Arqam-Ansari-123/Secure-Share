"""THE PUBLIC SURFACE. Everything in this file is reachable by an external
client with a link, and nothing else is.

These two endpoints — and only these two — are what the reverse proxy exposes to
the internet. Secret CREATION deliberately lives in routes_sender.py behind the
staff gate; keeping it here was the critical hole in Phase 1, where it depended
on a helper that minted an identity for anyone who asked. There is now no
identity dependency in this module at all, so that mistake cannot recur quietly.

The entire one-time guarantee lives here. Two rules make it work:

  * every GET is non-destructive, so email scanners, chat unfurlers and browser
    prefetch cannot burn a link;
  * POST /reveal is the only caller of store.take_blob(), the only GETDEL.
"""

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

import audit
import db
import notify
import schemas
import security
import store

router = APIRouter(prefix="/api", tags=["public"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _limit(scope: str, key: str | None) -> None:
    if key and not await store.rate_ok(scope, key):
        raise HTTPException(429, "too many requests", headers={"Retry-After": "60"})


async def _mark(tid: str, status: str, reason: str) -> None:
    await db.execute(
        "UPDATE secrets SET status=%s, status_at=now(), status_reason=%s WHERE tid=%s AND status='active'",
        (status, reason, tid),
    )


# ------------------------------------------------------------------ meta ---

@router.get("/s/{token}/meta", response_model=schemas.MetaOut)
async def secret_meta(token: str, request: Request):
    """Non-destructive on purpose: this is what a link preview hits."""
    await _limit("meta", security.client_ip(request))
    tid = security.tid_of(token)

    row = await db.fetchrow("SELECT * FROM secrets WHERE tid=%s", (tid,))
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "active":
        raise HTTPException(410, row["status"])
    if row["expires_at"] <= _now() or not await store.blob_exists(tid):
        await _mark(tid, "expired", "time_expired")
        await audit.record(tid, audit.EXPIRED, request=request, reason="time_expired")
        raise HTTPException(410, "expired")

    await audit.record(tid, audit.PEEKED, request=request)
    return schemas.MetaOut(
        has_passphrase=row["has_passphrase"],
        kdf_salt=base64.b64encode(row["kdf_salt"]).decode() if row["kdf_salt"] else None,
        kdf_iters=row["kdf_iters"],
        expires_at=row["expires_at"],
        size_bytes=row["size_bytes"],
        attempts_remaining=row["max_attempts"] - row["failed_attempts"],
        reveal_ticket=await store.issue_ticket(tid),
    )


# ---------------------------------------------------------------- reveal ---

@router.post("/s/{token}/reveal", response_model=schemas.RevealOut)
async def reveal_secret(token: str, body: schemas.RevealIn, request: Request, bg: BackgroundTasks):
    tid = security.tid_of(token)
    await _limit("reveal_ip", security.client_ip(request))
    await _limit("reveal_tid", tid)  # caps online guessing even as IPs rotate

    row = await db.fetchrow("SELECT * FROM secrets WHERE tid=%s", (tid,))
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "active":
        raise HTTPException(410, row["status"])
    if row["expires_at"] <= _now():
        await _mark(tid, "expired", "time_expired")
        raise HTTPException(410, "expired")

    if await store.consume_ticket(body.ticket) != tid:
        raise HTTPException(400, "invalid or expired reveal ticket")

    sent = base64.b64decode(body.verifier.get_secret_value()) if body.verifier else None
    if not security.verifier_ok(sent, row["verifier_hash"]):
        ttl = int((row["expires_at"] - _now()).total_seconds())
        fails = await store.bump_fails(tid, max(ttl, 60))
        await db.execute("UPDATE secrets SET failed_attempts=%s WHERE tid=%s", (fails, tid))
        remaining = row["max_attempts"] - fails
        if remaining <= 0:
            await store.drop_blob(tid)
            await _mark(tid, "destroyed", "attempts_exceeded")
            await audit.record(tid, audit.DESTROYED, request=request, ok=False,
                               reason="attempts_exceeded")
            raise HTTPException(403, "destroyed: too many failed attempts")
        await audit.record(tid, audit.REVEAL_FAIL, request=request, ok=False,
                           attempts_remaining=remaining)
        raise HTTPException(401, f"wrong passphrase, {remaining} attempts remaining")

    payload = await store.take_blob(tid)  # <-- the one and only GETDEL
    if payload is None:
        await _mark(tid, "expired", "time_expired")
        raise HTTPException(410, "already viewed or expired")

    # Only now, with the bytes in hand, is it true that the secret was viewed.
    await _mark(tid, "viewed", "viewed")
    await audit.record(tid, audit.REVEAL_OK, request=request, size_bytes=len(payload))
    bg.add_task(notify.secret_viewed, tid, row["webhook_url"], row["notify_email"],
                security.client_ip(request))

    return schemas.RevealOut(blob=base64.b64encode(payload).decode(), size_bytes=len(payload))
