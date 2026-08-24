"""Tokens, constant-time comparison, response headers, log redaction, SSRF guard."""

import hashlib
import hmac
import ipaddress
import logging
import re
import secrets as pysecrets
import socket
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware

import config

# --- link tokens -----------------------------------------------------------
# The token is never stored. tid = sha256(token) is the Postgres PK and the
# Redis key suffix, so a full database dump yields no working links.

def new_token() -> str:
    return pysecrets.token_urlsafe(32)


def tid_of(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_verifier(verifier: bytes) -> bytes:
    return hashlib.sha256(verifier).digest()


def verifier_ok(sent: bytes | None, stored: bytes | None) -> bool:
    if not stored:
        return True  # no passphrase on this secret
    if not sent:
        return False
    return hmac.compare_digest(hashlib.sha256(sent).digest(), stored)


# --- request context -------------------------------------------------------

def client_ip(request) -> str | None:
    # Requires uvicorn --proxy-headers; without it every row records the proxy.
    return request.client.host if request.client else None


def user_agent(request) -> str | None:
    ua = request.headers.get("user-agent")
    return ua[:512] if ua else None


# --- response headers ------------------------------------------------------

class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        h = resp.headers
        h["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        h["Pragma"] = "no-cache"
        h["Expires"] = "0"
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        # Load-bearing: without this the path token leaks to third-party
        # origins via the Referer header.
        h["Referrer-Policy"] = "no-referrer"
        h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        h["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if config.IS_PROD:
            h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return resp


# --- log redaction ---------------------------------------------------------

_SECRETISH = re.compile(r"[A-Za-z0-9_\-+/=]{64,}")


class RedactFilter(logging.Filter):
    """Last line of defence: scrub long base64-ish runs from every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = _SECRETISH.sub("[redacted]", record.msg)
            if record.args:
                record.args = tuple(
                    _SECRETISH.sub("[redacted]", a) if isinstance(a, str) else a
                    for a in record.args
                )
        except Exception:
            pass
        return True


def install_log_redaction() -> None:
    logging.getLogger().addFilter(RedactFilter())
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "secureshare"):
        logging.getLogger(name).addFilter(RedactFilter())


def redact_path(path: str) -> str:
    """/api/s/<token>/meta -> /api/s/<8 chars>…/meta. The raw token is half the
    credential; logging it would allow replay before the secret is burned."""
    return re.sub(r"(/api/s/)([^/]+)", lambda m: f"{m.group(1)}{m.group(2)[:8]}…", path)


# --- SSRF guard for sender-supplied webhook URLs ---------------------------

def webhook_allowed(url: str) -> bool:
    """The server fetches this URL from inside the compose network, where
    http://postgres:5432 and http://169.254.169.254/ are both reachable."""
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    if config.IS_PROD and u.scheme != "https":
        return False
    if not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except Exception:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def sign(payload: bytes) -> str:
    return hmac.new(config.WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()
