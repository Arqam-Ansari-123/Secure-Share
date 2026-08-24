"""Administrator surface — the company-wide activity log.

Separate from routes_sender.py because the gate is different: every route here
requires `is_admin`, not merely a signed-in employee. Router-level, so an
endpoint added later inherits it.

This is the only place account-lifecycle events (logins, failed logins, password
changes) are readable. They are written with tid = NULL, so the per-secret
audit trail cannot return them.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query

import audit
import auth
import schemas

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_admin)])


@router.get("/activity", response_model=schemas.ActivityPage)
async def activity(
    staff: auth.Staff = Depends(auth.require_admin),
    event: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    cursor: int | None = Query(default=None),
):
    rows = await audit.activity(
        event=event, actor=actor, since=since, until=until, limit=limit, cursor=cursor
    )
    # Keyset pagination: the caller passes the last id back as `cursor`. A full
    # page implies there may be more; a short page is definitively the end.
    next_cursor = rows[-1]["id"] if len(rows) == limit else None
    return schemas.ActivityPage(rows=rows, next_cursor=next_cursor)


@router.get("/actors", response_model=list[str])
async def actors(staff: auth.Staff = Depends(auth.require_admin)):
    """Distinct actors, for the filter dropdown."""
    return await audit.distinct_actors()
