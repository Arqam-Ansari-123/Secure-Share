"""The single audit writer.

Every audit row in the system goes through `record()`. `detail` is built from a
fixed key allowlist, never from request data — that is what guarantees secret
content can never reach the trail.
"""

import json
import logging

import db
import security

log = logging.getLogger("secureshare")

CREATED = "created"
PEEKED = "peeked"
REVEAL_OK = "reveal_ok"
REVEAL_FAIL = "reveal_fail"
REVOKED = "revoked"
EXPIRED = "expired"
DESTROYED = "destroyed"
NOTIFIED = "notified"

# Account lifecycle. These carry tid = NULL — they belong to no secret.
LOGIN_OK = "login_ok"
LOGIN_FAIL = "login_fail"
LOGOUT = "logout"
PASSWORD_CHANGED = "password_changed"
ACCOUNT_CREATED = "account_created"
ACCOUNT_DISABLED = "account_disabled"

# Inbound credential requests.
REQUEST_CREATED = "request_created"
REQUEST_VIEWED = "request_viewed"
REQUEST_FULFILLED = "request_fulfilled"
REQUEST_REVOKED = "request_revoked"

# Only these keys may ever appear in audit.events.detail.
DETAIL_KEYS = {"reason", "attempts_remaining", "status_code", "size_bytes", "target",
               "subject", "auth_source"}


async def record(
    tid: str | None,
    event: str,
    *,
    request=None,
    actor=None,  # auth.Staff | None — None for reveal/peek/expire, which have no actor
    ok: bool = True,
    **detail,
) -> None:
    clean = {k: v for k, v in detail.items() if k in DETAIL_KEYS}
    try:
        await db.execute(
            """INSERT INTO audit.events
                   (tid, actor_user_id, actor_email, event, ok, ip, user_agent, detail)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                tid,
                actor.id if actor else None,
                actor.email if actor else None,
                event,
                ok,
                security.client_ip(request) if request else None,
                security.user_agent(request) if request else None,
                json.dumps(clean) if clean else None,
            ),
        )
    except Exception:
        # An audit failure must never 500 a reveal. Log the event name only —
        # never the exception payload, which could carry request data.
        log.error("audit write failed for event=%s", event)


async def trail(tid: str) -> list[dict]:
    return await db.fetch(
        """SELECT event, ok, at, host(ip) AS ip, user_agent, detail, actor_email
           FROM audit.events WHERE tid = %s ORDER BY at ASC, id ASC""",
        (tid,),
    )


async def activity(
    *,
    event: str | None = None,
    actor: str | None = None,
    since=None,
    until=None,
    limit: int = 100,
    cursor: int | None = None,
) -> list[dict]:
    """The company-wide feed, for administrators.

    Spans every secret AND the account-lifecycle rows, which carry tid = NULL
    and were therefore unreachable through trail() — the rows existed but no
    endpoint could read them.

    Paginated by descending id rather than OFFSET: this table only ever grows,
    and OFFSET degrades linearly as it does.
    """
    where = ["TRUE"]
    params: list = []

    if event:
        where.append("event = %s")
        params.append(event)
    if actor:
        where.append("actor_email = %s")
        params.append(actor)
    if since:
        where.append("at >= %s")
        params.append(since)
    if until:
        where.append("at <= %s")
        params.append(until)
    if cursor:
        where.append("id < %s")
        params.append(cursor)

    params.append(max(1, min(limit, 500)))
    return await db.fetch(
        f"""SELECT id, tid, event, ok, at, host(ip) AS ip, user_agent, detail, actor_email
            FROM audit.events
            WHERE {' AND '.join(where)}
            ORDER BY id DESC
            LIMIT %s""",
        tuple(params),
    )


async def distinct_actors() -> list[str]:
    """For the filter dropdown."""
    rows = await db.fetch(
        "SELECT DISTINCT actor_email FROM audit.events "
        "WHERE actor_email IS NOT NULL ORDER BY actor_email"
    )
    return [r["actor_email"] for r in rows]
