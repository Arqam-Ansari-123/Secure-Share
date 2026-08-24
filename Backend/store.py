"""Redis — the only place secret ciphertext ever lives.

Key schema
    sec:{tid}        the entire opaque envelope (IV || ciphertext)   TTL = lifetime
    sec:{tid}:fails  failed verifier attempts                        TTL = lifetime
    tkt:{ticket}     tid, issued by /meta and consumed by /reveal    TTL = 300s
    rl:{scope}:{k}:{window}  rate-limit counter                      TTL = window

One-time semantics are enforced by GETDEL, which lives in exactly one function
(`take_blob`) called from exactly one place (POST /reveal). Two concurrent
reveals: exactly one receives bytes.
"""

import secrets as pysecrets
import time

import redis.asyncio as aioredis

import config

r: aioredis.Redis | None = None


async def connect() -> None:
    global r
    r = aioredis.from_url(config.REDIS_URL, decode_responses=False)
    await r.ping()


async def close() -> None:
    if r:
        await r.aclose()


async def healthy() -> bool:
    try:
        await r.ping()
        return True
    except Exception:
        return False


# --- the secret envelope ---------------------------------------------------

async def put_blob(tid: str, blob: bytes, ttl: int) -> None:
    await r.set(f"sec:{tid}", blob, ex=ttl)


async def take_blob(tid: str) -> bytes | None:
    """Atomically read-and-destroy. The ONLY GETDEL in the codebase."""
    return await r.getdel(f"sec:{tid}")


async def drop_blob(tid: str) -> None:
    """Revoke / attempts-exceeded destruction."""
    await r.delete(f"sec:{tid}", f"sec:{tid}:fails")


async def blob_exists(tid: str) -> bool:
    return bool(await r.exists(f"sec:{tid}"))


async def bump_fails(tid: str, ttl: int) -> int:
    key = f"sec:{tid}:fails"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, ttl)
    return n


# --- reveal tickets --------------------------------------------------------

async def issue_ticket(tid: str) -> str:
    ticket = pysecrets.token_urlsafe(24)
    await r.set(f"tkt:{ticket}", tid.encode(), ex=config.REVEAL_TICKET_TTL)
    return ticket


async def consume_ticket(ticket: str) -> str | None:
    raw = await r.getdel(f"tkt:{ticket}")
    return raw.decode() if raw else None


# --- rate limiting (fixed window; ~8 lines instead of a dependency) --------

async def rate_ok(scope: str, key: str) -> bool:
    limit, window = config.RATE_LIMITS[scope]
    bucket = int(time.time()) // window
    rk = f"rl:{scope}:{key}:{bucket}"
    n = await r.incr(rk)
    if n == 1:
        await r.expire(rk, window)
    return n <= limit
