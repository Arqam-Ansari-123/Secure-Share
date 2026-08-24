"""THE STAFF SURFACE. Every route here requires an authenticated Genetech user.

The gate is applied at ROUTER level rather than per-route, so an endpoint added
here later is guarded by default. That is the whole reason `create_secret` lives
in this file instead of alongside the other /secrets handlers: in Phase 1 it sat
in the public module behind a helper that minted an identity for anyone who
asked, which meant anyone on the internet could create secrets on the Genetech
domain. Placement now carries the security property.

No route in this file ever returns secret content or a link token. The dashboard
addresses secrets by tid — which is sha256(token) and therefore useless as a link.
"""

import base64
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import audit
import auth
import config
import db
import schemas
import security
import store

router = APIRouter(prefix="/api", tags=["staff"], dependencies=[Depends(auth.require_staff)])

CHUNK = 64 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ttl_seconds(meta: schemas.CreateMeta) -> int:
    if meta.expiry_preset == "custom":
        want = meta.expires_in or 3600
    else:
        want = schemas.PRESETS.get(meta.expiry_preset)
        if want is None:
            raise HTTPException(400, "unknown expiry_preset")
    return max(60, min(want, config.MAX_TTL_SECONDS))


async def _read_capped(upload: UploadFile) -> bytes:
    """Streaming running total — Content-Length is attacker-controlled, so a
    bare read() behind a header check is a memory-exhaustion DoS."""
    out, total = bytearray(), 0
    while chunk := await upload.read(CHUNK):
        total += len(chunk)
        if total > config.MAX_BLOB_BYTES:
            raise HTTPException(413, "secret too large")
        out.extend(chunk)
    if not total:
        raise HTTPException(400, "empty payload")
    return bytes(out)


# ---------------------------------------------------------------- create ---

@router.post("/secrets", status_code=201, response_model=schemas.CreateOut)
async def create_secret(
    request: Request,
    meta: str = Form(...),
    blob: UploadFile = File(...),
    staff: auth.Staff = Depends(auth.require_staff),
):
    if not await store.rate_ok("create", security.client_ip(request) or "?"):
        raise HTTPException(429, "too many requests", headers={"Retry-After": "60"})

    m = schemas.CreateMeta.model_validate_json(meta)
    if m.webhook_url and not security.webhook_allowed(m.webhook_url):
        raise HTTPException(400, "webhook_url not allowed")

    payload = await _read_capped(blob)
    ttl = _ttl_seconds(m)
    token = security.new_token()
    tid = security.tid_of(token)
    expires_at = _now() + timedelta(seconds=ttl)

    verifier_hash = None
    if m.has_passphrase:
        if not (m.verifier and m.kdf_salt and m.kdf_iters):
            raise HTTPException(400, "passphrase material incomplete")
        verifier_hash = security.hash_verifier(base64.b64decode(m.verifier.get_secret_value()))

    # Redis first: if the metadata insert then fails, the orphaned blob expires
    # on its own TTL. The reverse order would leave a row pointing at nothing.
    await store.put_blob(tid, payload, ttl)
    await db.execute(
        """INSERT INTO secrets (tid, user_id, expires_at, has_passphrase, kdf_salt, kdf_iters,
                                verifier_hash, max_attempts, size_bytes, label,
                                webhook_url, notify_email)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            tid, staff.id, expires_at, m.has_passphrase,
            base64.b64decode(m.kdf_salt) if m.kdf_salt else None,
            m.kdf_iters, verifier_hash, m.max_attempts,
            len(payload), m.label, m.webhook_url, m.notify_email,
        ),
    )
    await audit.record(tid, audit.CREATED, request=request, actor=staff, size_bytes=len(payload))

    # The URL comes from PUBLIC_BASE_URL, not from the staff member's own origin,
    # so a link created on the internal host still points at the public one.
    return schemas.CreateOut(
        token=token, tid=tid, url=f"{config.PUBLIC_BASE_URL}/s/{token}", expires_at=expires_at
    )


# ------------------------------------------------------------- dashboard ---

@router.get("/secrets", response_model=list[schemas.SecretRow])
async def list_secrets(staff: auth.Staff = Depends(auth.require_staff)):
    # Own secrets; admins see everything. Scoping stays in the WHERE clause as a
    # bound parameter — never filtered in Python after the fact.
    return await db.fetch(
        """SELECT s.tid, s.label, s.created_at, s.expires_at, s.status, s.status_at,
                  s.status_reason, s.has_passphrase, s.size_bytes,
                  s.failed_attempts, s.max_attempts, u.email AS created_by
           FROM secrets s JOIN users u ON u.id = s.user_id
           WHERE (s.user_id = %s OR %s) ORDER BY s.created_at DESC LIMIT 200""",
        (staff.id, staff.admin),
    )


@router.post("/secrets/{tid}/revoke", status_code=204)
async def revoke_secret(tid: str, request: Request,
                        staff: auth.Staff = Depends(auth.require_staff)):
    row = await db.fetchrow(
        "SELECT status FROM secrets WHERE tid=%s AND (user_id=%s OR %s)",
        (tid, staff.id, staff.admin),
    )
    if not row:
        raise HTTPException(404, "not found")
    if row["status"] != "active":
        raise HTTPException(409, f"already {row['status']}")

    await store.drop_blob(tid)
    await db.execute(
        "UPDATE secrets SET status='revoked', status_at=now(), status_reason='revoked' WHERE tid=%s",
        (tid,),
    )
    await audit.record(tid, audit.REVOKED, request=request, actor=staff, reason="revoked")


@router.get("/secrets/{tid}/audit", response_model=list[schemas.AuditRow])
async def secret_audit(tid: str, staff: auth.Staff = Depends(auth.require_staff)):
    owned = await db.fetchrow(
        "SELECT 1 FROM secrets WHERE tid=%s AND (user_id=%s OR %s)",
        (tid, staff.id, staff.admin),
    )
    if not owned:
        raise HTTPException(404, "not found")
    return await audit.trail(tid)
