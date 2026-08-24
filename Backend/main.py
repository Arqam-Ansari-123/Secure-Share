"""SecureShare — one-time secret sharing.
Genetech Solutions.

App wiring: lifespan (pools + expiry sweeper), middleware, routers.
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

# NOTE for Windows dev: psycopg's async mode cannot run on the ProactorEventLoop
# that Python uses by default on Windows, and uvicorn passes its own loop_factory
# to asyncio.run() — so setting an event loop policy here would have no effect.
# Start the server with `python run_dev.py` instead of the uvicorn CLI.
# Linux and the Docker image are unaffected and use the normal uvicorn command.

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware

import audit
import auth
import config
import db
import routes_admin
import routes_auth
import routes_requests
import routes_secrets
import routes_sender
import security
import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("secureshare")


async def sweeper() -> None:
    """Redis TTL already deleted the content. This only reconciles Postgres
    status and writes the audit row, every 60s."""
    while True:
        try:
            rows = await db.fetch(
                """UPDATE secrets SET status='expired', status_at=now(), status_reason='time_expired'
                   WHERE status='active' AND expires_at <= now() RETURNING tid"""
            )
            for row in rows:
                await audit.record(row["tid"], audit.EXPIRED, reason="time_expired")
            if rows:
                log.info("sweeper expired %d secret(s)", len(rows))
        except Exception:
            log.warning("sweeper pass failed")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    security.install_log_redaction()
    await db.connect()
    await store.connect()
    task = asyncio.create_task(sweeper())
    log.info("SecureShare ready (env=%s)", config.ENV)
    yield
    task.cancel()
    await store.close()
    await db.close()


app = FastAPI(
    title="SecureShare",
    description="One-time secret sharing by Genetech Solutions. The server stores "
                "ciphertext it cannot decrypt — encryption keys never leave the browser.",
    version="2.0.0",
    lifespan=lifespan,
    # Publishing the internal API surface is a reconnaissance gift. redoc_url is
    # on by default and easy to forget.
    docs_url=None if config.IS_PROD else "/docs",
    redoc_url=None if config.IS_PROD else "/redoc",
    openapi_url=None if config.IS_PROD else "/openapi.json",
)

# --- middleware (outermost first) ------------------------------------------

# Unconditional. The old `if ALLOWED_HOSTS != ["*"]` guard WAS the fail-open:
# forgetting the env var disabled Host validation instead of erroring. config.py
# now refuses to start in production without an explicit list.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.ALLOWED_HOSTS)
if config.IS_PROD:
    app.add_middleware(HTTPSRedirectMiddleware)

app.add_middleware(security.SecurityHeaders)

# Never allow_origins=["*"] here: Starlette silently drops allow_credentials
# when origins is "*", which looks permissive but quietly breaks the cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def access_log(request: Request, call_next):
    """Replaces uvicorn's access log (started with --no-access-log) so the link
    token never lands in a log line — it is half the credential."""
    started = time.perf_counter()
    response = await call_next(request)
    log.info(
        "%s %s -> %s (%.0fms)",
        request.method,
        security.redact_path(request.url.path),
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """FastAPI's default 422 echoes the offending input back — which would put
    ciphertext in a response body and in any error log. Return loc+msg only."""
    return JSONResponse(
        status_code=422,
        content={"detail": [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()]},
    )


app.include_router(routes_auth.router)
app.include_router(routes_secrets.router)
app.include_router(routes_sender.router)
app.include_router(routes_requests.staff_router)
app.include_router(routes_requests.public_router)
app.include_router(routes_admin.router)


@app.get("/api/health")
async def health():
    pg, rd = await db.healthy(), await store.healthy()
    return {"ok": pg and rd, "postgres": pg, "redis": rd}


# --- the boundary, asserted at startup --------------------------------------
# Every route that is not explicitly public must carry require_staff. Checking
# it here turns "we remembered to add the dependency" into "the process refuses
# to boot if we forgot" — which is the only version that survives future edits.

PUBLIC_PATHS = frozenset({
    "/api/health",
    "/api/auth/login",
    "/api/auth/logout",
    # Outbound: a client opens a link we sent them.
    "/api/s/{token}/meta",
    "/api/s/{token}/reveal",
    # Inbound: a client answers a credential request. Public by necessity —
    # clients have no account. The request token is the authorization: it was
    # issued by a named employee, is scoped to one request, expires, and can be
    # revoked. This is what lets clients send us secrets without opening
    # /create to the internet.
    "/api/r/{token}",
    "/api/r/{token}/submit",
    "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc",
})


# require_admin wraps require_staff but is a distinct callable, so it must be
# named here too — otherwise every admin route reads as unguarded and the app
# refuses to boot.
GATES = (auth.require_staff, auth.require_admin)


def _guards(dependant) -> bool:
    if any(d.call in GATES for d in [dependant] + list(dependant.dependencies)):
        return True
    return any(_guards(sub) for sub in dependant.dependencies)


def assert_boundary() -> None:
    unguarded = [
        r.path
        for r in app.routes
        if getattr(r, "dependant", None) is not None
        and r.path not in PUBLIC_PATHS
        and not _guards(r.dependant)
    ]
    if unguarded:
        raise RuntimeError(
            "SECURITY: these routes are neither public nor guarded by require_staff: "
            + ", ".join(sorted(unguarded))
            + " — add the dependency, or add the path to PUBLIC_PATHS deliberately."
        )
    log.info("boundary OK: %d public paths, all others require staff auth", len(PUBLIC_PATHS))


assert_boundary()
